var express = require("express"),
  bodyParser = require('body-parser'),
  fs = require('fs'),
  pjson = require('./package.json'),
  _ = require("lodash"),
  child = require('child_process').fork,
  multipart = require('connect-multiparty')(),
  koop = require('./lib');

module.exports = function( config ) {
  var app = express(), route, controller, model;

  // keep track of the registered services
  app.services = {};

  koop.config = config;

  // handle POST requests
  app.use(bodyParser());

  // init the koop log based on config params
  koop.log = new koop.Logger( config );

  //request parameters can come from query url or POST body
  app.use(function(req, res, next) {
    req.query=_.extend(req.query || {}, req.body || {});
    next();
  });

  // store the sha so we know what version of koop this is
  app.status = {
    version: pjson.version,
    providers: {}
  };

  // for demos and preview maps in providers 
  app.set('view engine', 'ejs');

  app.use(express.static(__dirname + '/public'));

  // serve all the provider json
  app.get("/providers", function(req, res, next) {
    res.json(app.services);
  });

  // serve up a provider
  app.get("/providers/:provider", function(req, res, next) {
    res.json(app.services[req.params.provider]);
  });

  // gets all the datasets in the cache for a provider
  app.get("/providers/:provider/datasets", function(req, res, next) {
    koop.Cache.db._query("select * from koopinfo where id ilike '%" + req.params.provider + "%'", function(err, result){
      res.json( result.rows );
    })
  });

  // register providers into the app
  // sets up models, routes -> controllers/handlers
  app.register = function(provider){
    if (provider.type && provider.type == 'plugin'){
      return app.registerPlugin( provider );
    }

    // only register if the provider has a name
    if ( provider.name ) {
      app.services[provider.name] = provider;

      // save the provider onto the app
      model = new provider.model( koop );

      // pass the model to the controller
      controller = new provider.controller( model, koop.BaseController );

      // if a provider has a status object store it
      if ( provider.status ) {
        app.status.providers[provider.name] = provider.status;
      }

      // binds a series of standard routes
      if ( provider.name && provider.pattern ) {
        app._bindDefaultRoutes(provider.name, provider.pattern, controller );
      }

      // add each route, the routes let us override defaults etc.
      app._bindRoutes( provider.routes, controller );
    }
  };

  app.registerPlugin = function( plugin ){
    koop[plugin.name] = plugin;
  };

  var defaultRoutes = {
    'featureserver': ['/FeatureServer/:layer/:method', '/FeatureServer/:layer', '/FeatureServer'],
    'preview':['/preview'],
    'drop':['/drop']
  };

  // assigns a series of default routes; assumes
  app._bindDefaultRoutes = function( name, pattern, controller ){
    var routes, handler;
    for ( handler in defaultRoutes ){
      if ( controller[ handler ] ){
        defaultRoutes[ handler ].forEach(function(route){
          app[ 'get' ]( '/'+ name + pattern + route, controller[ handler ]);
          // add multipart middleware for POSTs to featureservices
          app[ 'post' ]( '/'+ name + pattern + route, multipart, controller[ handler ]);
        });
      }
    }
  };


  // bind each route in a list to controller handler
  app._bindRoutes = function( routes, controller ){
    for ( route in routes ){
      var path = route.split(' ');
      app[ path[0] ]( path[1], controller[ routes[ route ] ]);
    }
  };

  // ---------------------------------------------------
  // TODO I'd like to change most of what's below here
  // ---------------------------------------------------

  // init koop centralized file access
  // this allows us to turn the FS access off globally
  koop.files = new koop.Files( koop );

  // Need the exporter to have access to the cache so we pass it Koop
  koop.exporter = new koop.Exporter( koop );

  // END annoying things that are changing
  // --------------------------------------------------


  koop.Cache = new koop.DataCache( koop );

  // use the default local cache until a DB adapter mod is registered
  if (!config.db || !config.db.conn){
    console.warn('Warning koop w/o persistent cache means no data will be cached across server sessions.');
  }

  koop.Cache.db = koop.LocalDB; 
 
  // registers a DB modules  
  app.registerCache = function( adapter ){
    if ( config.db && config.db.conn ) {
      koop.Cache.db = adapter.connect( config.db.conn, koop );
    } 
    else {
      console.log('Cannot register this cache, missing db connection in config');
    }
    return;
  };

  // remove the x powered by header from all responses
  app.use(function (req, res, next) {
      res.removeHeader("X-Powered-By");
      next();
  });

  // save the koop log onto the app
  app.log = koop.log;
  
  // use the default local cache until a DB adapter mod is registered
  if (!config.db || !config.db.conn){
    console.warn('Warning koop w/o persistent cache means no data will be cached across server sessions.');
  }
  koop.Cache.db = koop.LocalDB; 
 
  // registers a DB modules  
  app.registerCache = function( adapter ){
    if ( config.db && config.db.conn ) {
      koop.Cache.db = adapter.connect( config.db.conn, koop );
    } 
    else {
      console.log('Cannot register this cache, missing db connection in config');
    }
    return;
  };

  return app;

};
