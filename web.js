var async   = require('async');
var express = require('express');
var util    = require('util');
var mongo   = require('mongodb');

// create an express webserver
var app = express.createServer(
  express.logger(),
  express.static(__dirname + '/public'),
  express.bodyParser(),
  express.cookieParser(),
  // set this to a secret value to encrypt session cookies
  express.session({ secret: process.env.SESSION_SECRET || 'secret123' }),
  require('faceplate').middleware({
    app_id: process.env.FACEBOOK_APP_ID,
    secret: process.env.FACEBOOK_SECRET,
    scope:  ''
  })
);

// listen to the PORT given to us in the environment
var port = process.env.PORT || 3000;

app.listen(port, function() {
  console.log("Listening on " + port);
});

app.dynamicHelpers({
  'host': function(req, res) {
    return req.headers['host'];
  },
  'scheme': function(req, res) {
    return req.headers['x-forwarded-proto'] || 'http'
  },
  'url': function(req, res) {
    return function(path) {
      path = path || '';
      return app.dynamicViewHelpers.scheme(req, res) + ':' + app.dynamicViewHelpers.url_no_scheme(req, res)(path);
    }
  },
  'url_no_scheme': function(req, res) {
    return function(path) {
      path = path || '';
      return '//' + app.dynamicViewHelpers.host(req, res) + path;
    }
  },
});

function render_page(req, res) {
  req.facebook.app(function(app) {
    req.facebook.me(function(user) {
      res.render('index.ejs', {
        layout:    false,
        req:       req,
        app:       app,
        user:      user
      });
    });
  });
}

function handle_facebook_request(req, res) {

  // if the user is logged in
  if (req.facebook.token) {

    async.parallel([
      function(cb) {
        // query 4 friends and send them to the socket for this socket id
        req.facebook.get('/me/friends', { limit: 4 }, function(friends) {
          req.friends = friends;
          cb();
        });
      },
      function(cb) {
        // Connect to a mongo database via URI
        // With the MongoLab addon the MONGOLAB_URI config variable is added to your
        // Heroku environment.  It can be accessed as process.env.MONGOLAB_URI
        mongo.connect(process.env.MONGOLAB_URI, {}, function(error, db){
          if (error) {
            console.log('Error connection to MongoLab');
            cb();
            return;
          }

          // console.log will write to the heroku log which can be accessed via the
          // command line as "heroku logs"
          db.addListener("error", function(error){
            console.log("Error connecting to MongoLab");
          });

          db.collection('requests', function(err, collection) {
            if (err) {
              console.log('Error collection');
              cb();
              return;
            }
            collection.insert(req.query, function(err, result) {
              if (err) {
                console.log('Error insert');
                cb();
                return;
              }

              collection.find().toArray(function(err, items) {
                req.mongo = items;
                db.close();
                cb();
              });
            });
          });
        });
      }
    ], function() {
      render_page(req, res);
    });

  } else {
    render_page(req, res);
  }
}

app.get('/', handle_facebook_request);
app.post('/', handle_facebook_request);
