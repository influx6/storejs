(function(store){

	var nano = require('nano'),
		ts = require('tsk').ToolStack,
		util = ts.Utility,
		Promise = ts.Promise,
		helpers = ts.Helpers.HashMaps,
		couch = store.NanoCouchdb = store.Initor();

	couch.defaults  = {
		name: null,
		port: 5984,
		host: 'localhost',
		admin: false,
		key: null,
		cert: null,
		username: null,
		password: null,
		encrypted: false,
	};


	couch.urlConstruct = function(config){
		var fragment = (config.host.concat(':'.concat(config.port))).concat('/');
		return (('http://').concat((config.admin ? config.username.concat(':').concat(config.password) : "").concat(fragment)));
	};

	couch.responseFragment = function(err,body,header){
		return { err:err, body: body, header: header , id: (header && header.etag ? header.etag : null) };
	};

	couch.allDB = function(done,fail){
		return Promise.create(function(_self){
			nano(couch.urlConstruct(couch.defaults)).db.list(function(err,body,header){
					var res = couch.responseFragment(err,body,header);
					if(err) return _self.reject(res.body,res);
					return _self.resolve(res.body,res);
			});
		}).promise().done(done).fail(fail);
	};

	couch.request = function(doc,id,method,params,done,fail){
		return Promise.create(function(_self){
			nano(couch.urlConstruct(couch.defaults)).request({
				db: doc,
				doc: id,
				method: method,
				params: params
			},function(err,body,header){
				if(err) return _self.reject(couch.responseFragment(err,body,header));
				return _self.resolve(couch.responseFragment(err,body,header));
			});
		}).promise();
	};

	couch.relax = function(request){
		return Promise.create(function(_self,pipe){
			nano(couch.urlConstruct(couch.defaults)).relax(request,function(err,body,header){
				if(err) return _self.reject(couch.responseFragment(err,body,header));
				return _self.resolve(couch.responseFragment(err,body,header));
			});
		}).promise();
	};

	//lets you make a low request to couch using nano.relax function
	couch.streamRelax = function(request,pipe){
		if(!util.isObject(request)) return;
		if(pipe && !util.isObject(pipe)) return false;

		return Promise.create(function(_self){

			if(pipe) pipe.on('error',function(err){ _self.reject(err); });

			var stream = nano(couch.urlConstruct(couch.defaults)).relax(request,function(err,body,header){
				var res = couch.responseFragment(err,body,header);
				if(pipe) res.pipe = pipe;
				res.requestStream = stream;

				if(err) return _self.reject(res);
				return _self.resolve(res);
			});

			if(pipe) pipe.pipe(stream);
		}).promise();
	};

	couch.destroyDB = function(name,done,fail){
		return Promise.create(function(_self){
			nano(couch.urlConstruct(couch.defaults)).db.destroy(name,function(err,body,header){
					var res = couch.responseFragment(err,body,header);
					if(err) return _self.reject(res.body,res);
					return _self.resolve(res.body,res);
			});
		}).promise().done(done).fail(fail).done(function(){
			delete couch.Cache[name];
		});
	};

	couch.use = function(name,config){
		var db,nanod,fragment,url;
		if(db = helpers.fetch.call(couch.Cache,name)) return db;

		db = store.Shell();
		db.p = Promise.create();

		config = ((!config) ? util.clone(couch.defaults) : util.merge(couch.defaults, config));

		url = couch.urlConstruct(config)
		nanod = nano(url);

		// db.views = {};
		db.pipe = {};
		db.backend = 'nanoCouchdb';
		db.config = config;

		//basic cache to handle id lookup,this changes as their are more save operations
		//regardless of the doc begin saved
		db.ID = { ids:{} };

		db.ID.fetch = util.bind(ts.Helpers.HashMaps.fetch,db.ID.ids);
		db.ID.exists = util.bind(ts.Helpers.HashMaps.exists,db.ID.ids);
		db.ID.add = util.bind(ts.Helpers.HashMaps.add,db.ID.ids);
		db.ID.remove = util.bind(ts.Helpers.HashMaps.remove,db.ID.ids);
		db.ID.modify = util.bind(ts.Helpers.HashMaps.modify,db.ID.ids);

		db.config.name = name;

		db.api = function(){ return nanod; };

		db.all = function(){
			return this.view('all').done(function(res){
				res.body.rows.forEach(function(e){
					db.ID.add(e.id,e.value);
				});
			});
		};


		db.implode = function(done,fail){
			var self = this;
			return this.p.then(function(){
				return couch.destroy(self.config.name);
			}).done(done).fail(fail).done(function(){
				util.explode(self);
			});
		};

		db.info = function(doc){
			var self = this;
			return this.p.then(function(db){
				return Promise.create(function(_self){
					db.head(doc,function(err,body,header){
						if(err) return _self.reject(couch.responseFragment(err,body,header));
						return _self.resolve(couch.responseFragment(err,body,header));
					});
				});
			}).done(function(res){
				if(!self.ID.exists(doc)) self.ID.add(doc,util.clinseString(res.header.etag));
				self.ID.modify(doc,util.clinseString(res.header.etag));
			});
		};

		db.get = function(doc,rev,donefn,errfn){
			return this.p.then(function(db){
				return Promise.create(function(_self){
					db.get(doc,function(err,body){
						if(err) return _self.reject(err);
						return _self.resolve(body);
					});
				}).promise();
			}).done(donefn).fail(errfn);
		};	

		db.save = function(id,doc,donefn,errfn){
			var self = this;
			return this.p.then(function(db){
				return Promise.create(function(_self){
					db.insert(doc,id,function(err,body,header){
						if(err) return _self.reject(couch.responseFragment(err,body,header));
						return _self.resolve(couch.responseFragment(err,body,header));
					});
				}).promise();
			}).done(donefn).fail(errfn).done(function(res){
				self.ID.add(res.body.id,res.body.rev);
			});
		};

		db.update = function(id,doc,rev,done,fail){
			var self = this;
			return this.p.then(function(db){
				return Promise.create(function(_self){
					db.insert(doc,{ doc_name: id, rev: rev || self.ID.fetch(id) },function(err,body,header){
						if(err) return _self.reject(couch.responseFragment(err,body,header));
						return _self.resolve(couch.responseFragment(err,body,header));
					});
				});
			}).done(function(res){
				self.ID.modify(res.body.id,res.body.rev);
			}).done(done).fail(fail);
		};

		db.destroy = function(id,rev,donefn,errfn){
			var self = this;
			return this.p.then(function(db){
				return Promise.create(function(_self){
					db.destroy(id,rev || self.ID.fetch(id),function(err,body,header){
						if(err) return _self.reject(couch.responseFragment(err,body,header));
						return _self.resolve(couch.responseFragment(err,body,header));
					});
				}).promise();
			}).done(function(){
				self.ID.remove(id);
			}).done(donefn).fail(errfn);
		};

		db.changes = function(fn,params){
			var self = this;
			return this.p.then(function(db){
				db.changes(params,fn);
			});
		};

		db.view = function(view,rev,done,fail){
			var self = this;
			return this.p.then(function(db){
				return Promise.create(function(_self){
					db.view(self.config.name,view,function(err,body,header){
						if(err) return _self.reject(couch.responseFragment(err,body,header));
						return _self.resolve(couch.responseFragment(err,body,header));
					});
				});
			}).done(done).fail(fail);
		};

		db.getAttachment = function(doc,att,params,encoding){
			var self = this,
				op = function(rev){
					rev = util.clinseString(rev);
				 	var params = util.isObject(params) ? util.merge({ rev: rev },params) : { rev: rev };
					return couch.streamRelax({
						db: self.config.name, 
						doc: doc,
						att: att,
						method: 'GET', 
						params: params, 
						encoding: encoding
					});
				};

			if(!self.ID.fetch(doc)) return this.info(doc).then(function(res){ return op(res.header.etag); });
			return this.p.then(function(){ return op(self.ID.fetch(doc)); });
		};

		db.saveAttachment = function(doc,att,type,params,pipe,rev,encoding){
			var self = this,
				op = function(rev){
					rev = util.clinseString(rev);
				 	var params = util.isObject(params) ? util.merge({ rev: rev },params) : { rev: rev };
					return couch.streamRelax({
						db: self.config.name, 
						doc: doc,
						att: att,
						method: 'PUT', 
						params: params, 
						content_type: type,
						encoding: encoding
					},pipe);
				};

			if(!self.ID.fetch(doc)) return this.info(doc).then(function(res){ return op(res.header.etag); });
			return this.p.then(function(){ return op(self.ID.fetch(doc)); });
		};

		db.destroyAttachment = function(doc,att,params,encoding){
			var self = this,
				op = function(rev){
					rev = util.clinseString(rev);
				 	var params = util.isObject(params) ? util.merge({ rev: rev },params) : { rev: rev };
					return couch.streamRelax({
						db: self.config.name, 
						doc: doc,
						att: att,
						method: 'DELETE', 
						params: params, 
						encoding: encoding
					});
				};

			if(!self.ID.fetch(doc)) return this.info(doc).then(function(res){ return op(res.header.etag); });
			return this.p.then(function(){ return op(self.ID.fetch(doc)); });
		};

		// db.toSQL = function(){};
		// db.toXML = function(){};
		// db.toHTML = function(){};

		nanod.db.get(name,function(e,body){
			if(e && e.message === 'no_db_file'){
				nanod.db.create(name,function(){ db.p.resolve(nanod.use(name)); });
			}else{ 
				db.p.resolve(nanod.use(name));
			}
		});

		//setup a reference to the nano db instance
		db.p.done(function(a){ db.pipe.db = a; });

		//save basic view for all id and rev of all data
		db.save('_design/'.concat(name),{ 
			"_id": '_design/'.concat(name),
			"views": { "all": { "map": "function(doc){ emit(doc._id,doc._rev); }" } }
		});

		db.all();

		helpers.add.call(couch.Cache,name,db);

		db.done = function(){ db.p.done.apply(db.p,arguments); return this };
		db.fail = function(){ db.p.fail.apply(db.p,arguments); return this };
		db.then = function(){ db.p.then.apply(db.p,arguments); return this };
		db.always = function(){ db.p.always.apply(db.p,arguments); return this };

		
		return db;
	};

})(StoreJS);
