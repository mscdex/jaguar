var Router = require('../lib/Router');

var http = require('http'),
    path = require('path'),
    assert = require('assert'),
    inspect = require('util').inspect;

var t = -1,
    group = path.basename(__filename, '.js') + '/';

var tests = [
  { run: function() {
      var what = this.what,
          router = new Router();

      router.get(function(req, res) {
        res.$.json({ foo: 'bar' });
      });

      request(router, this.req, function(err, res) {
        assert(!err, makeMsg(what, 'Unexpected error: ' + err));
        assert(res.statusCode === 200,
               makeMsg(what, 'Wrong response statusCode: ' + res.statusCode));
        assert(res.headers['content-type'] === 'application/json; charset=utf-8',
               makeMsg(what, 'Wrong response content-type: '
                             + res.headers['content-type']));
        assert.deepEqual(JSON.parse(res.data),
                         { foo: 'bar' },
                         makeMsg(what, 'Wrong response: ' + inspect(res.data)));
        next();
      });
    },
    req: {
      method: 'GET',
      path: '/'
    },
    what: 'json(obj)'
  },
  { run: function() {
      var what = this.what,
          router = new Router();

      router.get(function(req, res) {
        res.$.json(418, { foo: 'bar' });
      });

      request(router, this.req, function(err, res) {
        assert(!err, makeMsg(what, 'Unexpected error: ' + err));
        assert(res.statusCode === 418,
               makeMsg(what, 'Wrong response statusCode: ' + res.statusCode));
        assert(res.headers['content-type'] === 'application/json; charset=utf-8',
               makeMsg(what, 'Wrong response content-type: '
                             + res.headers['content-type']));
        assert.deepEqual(JSON.parse(res.data),
                         { foo: 'bar' },
                         makeMsg(what, 'Wrong response: ' + inspect(res.data)));
        next();
      });
    },
    req: {
      method: 'GET',
      path: '/'
    },
    what: 'json(status, obj)'
  },
  { run: function() {
      var what = this.what,
          router = new Router();

      router.get(function(req, res) {
        res.$.jsonp('foo');
      });

      request(router, this.req, function(err, res) {
        assert(!err, makeMsg(what, 'Unexpected error: ' + err));
        assert(res.statusCode === 200,
               makeMsg(what, 'Wrong response statusCode: ' + res.statusCode));
        assert(res.headers['content-type'] === 'text/javascript; charset=utf-8',
               makeMsg(what, 'Wrong response content-type: '
                             + res.headers['content-type']));
        assert.deepEqual(res.data,
                         '/**/ typeof cb === \'function\' && cb("foo");',
                         makeMsg(what, 'Wrong response: ' + inspect(res.data)));
        next();
      });
    },
    req: {
      method: 'GET',
      path: '/?callback=cb'
    },
    what: 'jsonp(obj)'
  },
  { run: function() {
      var what = this.what,
          router = new Router();

      router.get(function(req, res) {
        res.$.jsonp(418, 'foo');
      });

      request(router, this.req, function(err, res) {
        assert(!err, makeMsg(what, 'Unexpected error: ' + err));
        assert(res.statusCode === 418,
               makeMsg(what, 'Wrong response statusCode: ' + res.statusCode));
        assert(res.headers['content-type'] === 'text/javascript; charset=utf-8',
               makeMsg(what, 'Wrong response content-type: '
                             + res.headers['content-type']));
        assert.deepEqual(res.data,
                         '/**/ typeof cb === \'function\' && cb("foo");',
                         makeMsg(what, 'Wrong response: ' + inspect(res.data)));
        next();
      });
    },
    req: {
      method: 'GET',
      path: '/?callback=cb'
    },
    what: 'jsonp(status, obj)'
  },
  { run: function() {
      var what = this.what,
          router = new Router();

      router.get(function(req, res) {
        res.$.send('foo');
      });

      request(router, this.req, function(err, res) {
        assert(!err, makeMsg(what, 'Unexpected error: ' + err));
        assert(res.statusCode === 200,
               makeMsg(what, 'Wrong response statusCode: ' + res.statusCode));
        assert(res.data === 'foo',
               makeMsg(what, 'Wrong response: ' + inspect(res.data)));
        next();
      });
    },
    req: {
      method: 'GET',
      path: '/'
    },
    what: 'send(body)'
  },
  { run: function() {
      var what = this.what,
          router = new Router();

      router.get(function(req, res) {
        res.$.send(418);
      });

      request(router, this.req, function(err, res) {
        assert(!err, makeMsg(what, 'Unexpected error: ' + err));
        assert(res.statusCode === 418,
               makeMsg(what, 'Wrong response statusCode: ' + res.statusCode));
        next();
      });
    },
    req: {
      method: 'GET',
      path: '/'
    },
    what: 'send(status)'
  },
  { run: function() {
      var what = this.what,
          router = new Router();

      router.get(function(req, res) {
        res.$.send(418, 'foo');
      });

      request(router, this.req, function(err, res) {
        assert(!err, makeMsg(what, 'Unexpected error: ' + err));
        assert(res.statusCode === 418,
               makeMsg(what, 'Wrong response statusCode: ' + res.statusCode));
        assert(res.data === 'foo',
               makeMsg(what, 'Wrong response: ' + inspect(res.data)));
        next();
      });
    },
    req: {
      method: 'GET',
      path: '/'
    },
    what: 'send(status, body)'
  },
  { run: function() {
      var what = this.what,
          router = new Router();

      router.get(function(req, res) {
        res.$.status(418);
        res.end('foo');
      });

      request(router, this.req, function(err, res) {
        assert(!err, makeMsg(what, 'Unexpected error: ' + err));
        assert(res.statusCode === 418,
               makeMsg(what, 'Wrong response statusCode: ' + res.statusCode));
        assert(res.data === 'foo',
               makeMsg(what, 'Wrong response: ' + inspect(res.data)));
        next();
      });
    },
    req: {
      method: 'GET',
      path: '/'
    },
    what: 'status(status)'
  },
];

function request(router, reqOpts, cb) {
  http.createServer(function(req, res) {
    this.close();
    router.handle(req, res);
  }).listen(0, 'localhost', function() {
    var port = this.address().port,
        called = false;
    reqOpts.host = 'localhost';
    reqOpts.port = port;
    http.request(reqOpts, function(res) {
      var buffer = '';
      res.on('data', function(d) {
        buffer += d;
      }).on('end', function() {
        if (called)
          return;
        res.data = buffer;
        cb(null, res);
      }).on('error', function(err) {
        called = true;
        cb(err);
      }).setEncoding('utf8');
    }).on('error', function(err) {
      called = true;
      cb(err);
    }).end();
  });
}

function next() {
  if (t === tests.length - 1)
    return;
  var v = tests[++t];
  v.run.call(v);
}

function makeMsg(what, msg) {
  return '[' + group + what + ']: ' + msg;
}

process.once('uncaughtException', function(err) {
  if (t > -1 && !/(?:^|\n)AssertionError: /i.test(''+err))
    console.log(makeMsg(tests[t].what, 'Unexpected Exception:'));
  throw err;
});
process.once('exit', function() {
  assert(t === tests.length - 1,
         makeMsg('_exit',
                 'Only finished ' + (t + 1) + '/' + tests.length + ' tests'));
});

next();
