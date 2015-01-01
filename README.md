
Description
===========

A fast, middleware-based http server for node.js.

This module grew out of some performance work I had previously done on Express,
but ultimately additional significant speed gains were not possible without
seriously breaking the existing Express API and such. However, many of the same
convenience functions found in Express are also available in jaguar, they're
just presented in a slightly different way.

The primary focus of this module is performance with the secondary focus being
staying as Express-like as much as possible. With that in mind, jaguar is not
100% compatible with Express modules (especially those that use any custom
methods that Express tags onto request and response objects).

Here are some of the notable breaking changes when compared to Express:

* All convenience functions/properties are placed on a special `$` property that
  exists on both the request and response objects.

* No request or response object properties are mutated during the lifetime of
  the request. This includes properties such as `req.url`, which are not
  rewritten to only show the relevant portion of the url to mounted routers'
  route handlers.

* There is no `app` object in jaguar. You only have a Router, which shares its
  config with other routers mounted to it. However how config settings are
  shared is not set in stone yet, so per-Router config may be possible in the
  future.

* `router.all()` is aliased to `router.use()`. That means individual route
  handlers are not added to the stack for each support HTTP method. This is less
  likely to break things compared to the other changes, but it should be noted.

* You can't mount a router multiple times.

* Router config is accessible via a plain `.config` object. This helps to remove
  ambiguity when `.get()` is called.

Now, what makes jaguar faster (than Express)?

* As previously mentioned, only a single `$` property is added to request and
  response objects. This prevents v8 from deoptimizing access to the request and
  response objects.

* jaguar uses a simple optimization that lets additional route handlers for the
  same path avoid redundant execution of path regular expressions. This allows
  for much greater, consistent performance (even when the route handler stack is
  large).

* Removal of functional Array methods (e.g. `.forEach()`, `.map()`, `.filter()`)
  and other language features which cause slowdowns (e.g. for-in loops).

* Other miscellaneous improvements such as caching of static values
  (e.g. RegExps and other objects) that can be safely reused across multiple
  requests, using string concatenation instead of `.join()`ing an array of
  strings, not leaking `arguments`, pulling try-catch blocks out into separate
  functions, etc.


Requirements
============

* [node.js](http://nodejs.org/) -- v0.10.0 or newer


Install
============

    npm install jaguar


Examples
========

* Render a template using ejs as the engine:

```javascript
var http = require('http');

var Router = require('jaguar');
var router = new Router();

router.config['view engine'] = 'ejs';
router.get('/', function(req, res) {
  res.$.render('index', { title: 'Hello World!' });
});

http.createServer(router).listen(8000);
```


Benchmarks
==========

Using the Express benchmark script (i5-4200U/4GB RAM/node v0.10.31):

```
  1 middleware
  14101.81

  5 middleware
  13056.00

  10 middleware
  13621.00

  15 middleware
  13416.07

  20 middleware
  12827.29

  30 middleware
  11484.99

  50 middleware
  11425.10

  100 middleware
  10120.43
```
