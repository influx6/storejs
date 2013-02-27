var StoreJS = {};

if(typeof module.exports !== 'undefined') module.exports = StoreJS;
else this.StoreJS = StoreJS;

StoreJS.Initor = function(){
	return {
		use: function(){},
		allDB: function(){},
		destroyDB: function(){},
		Cache: {}
	}
};

StoreJS.Shell  = function(){
	return  {
		pipe: function(){},
		get: function(){},
		destroy: function(){},
		save: function(){},
		update: function(){},
		implode: function(){},
		all: function(){},
		updateAll: function(){},
		collectAll: function(){},
		api: function(){},
		sync: function(){},
	};
};

