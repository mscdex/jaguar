var http = require('http'),
    isRegExp = require('util').isRegExp,
    isError = require('util').isError,
    resolve = require('path').resolve;

var qsparse = require('./querystring').parse,
    urljoin = require('./path-join'),
    Request = require('./Request'),
    Response = require('./Response'),
    View = require('./view');

var pathRegex = require('path-to-regexp');

var EMPTY_PARAMS = {},
    STATUS_CODES = http.STATUS_CODES,
    ROUTES_MATCH_ALL = [ '' ],
    NO_KEYS = [],
    METHODS;

if (http.METHODS)
  METHODS = http.METHODS;
else {
  METHODS = [
    'DELETE',
    'GET',
    'HEAD',
    'POST',
    'PUT',
    /* PATHOLOGICAL */
    'CONNECT',
    'OPTIONS',
    'TRACE',
    /* WEBDAV */
    'COPY',
    'LOCK',
    'MKCOL',
    'MOVE',
    'PROPFIND',
    'PROPPATCH',
    'SEARCH',
    'UNLOCK',
    /* SUBVERSION */
    'REPORT',
    'MKACTIVITY',
    'CHECKOUT',
    'MERGE',
    /* UPNP */
    'MSEARCH',
    'NOTIFY',
    'SUBSCRIBE',
    'UNSUBSCRIBE',
    /* RFC-5789 */
    'PATCH',
    'PURGE'
  ].sort();
}
METHODS = METHODS.map(function(method) { return method.toLowerCase(); });

function Router(opts) {
  var self = this,
      env = process.env.NODE_ENV || 'development';

  // the route handler stack contains two possible kinds of objects:
  //   1. A normal route handler containing:
  //
  //          id - This is an integer that uniquely identifies this handler in
  //               this router instance. This value allows us to efficiently
  //               check if a particular route handler's path was previously
  //               matched.
  //          re - This is a regular expression to use in matching the request's
  //               url.
  //        keys - This is an array containing the names of placeholders in
  //               the handler's regular expression. This is used to help
  //               populate req.$.params.
  //     handler - This is a function in the case of a non-method-specific
  //               middleware function, or an object containing the method
  //               and the handler function.
  //
  //   2. A "pointer" route handler. This is a special route handler that shares
  //      a path regexp and param keys with another route handler. It contains:
  //
  //      parent - This is a reference to the previous route handler with whom
  //               the regexp and param keys are shared.
  //     handler - This is the same format as normal route handlers.
  this._stack = [];

  this._paramFuncs = {};
  this._mounted = false;
  this._rc = 0;

  this.path = '/';
  this.locals = Object.create(null);
  this.config = {
    'etag': 'weak',
    'env': env,
    'query parser': 'extended',
    'subdomain offset': 2,
    'trust proxy': false,
    'view': View,
    'views': resolve('views'),
    'jsonp callback name': 'callback',
    'view cache': (env === 'production')
  };
  this.handler = function routerHandlerWrap(req, res, cb) {
    self.handle(req, res, cb);
  };
}

Router.prototype.handle = function handle(req, res, cb) {
  var stack = this._stack,
      stacklen = stack.length,
      paramFuncs = this._paramFuncs,
      paramsCache = {},
      paramPtr = 0,
      matched = {},
      ptr = 0,
      req$,
      res$;

  req$ = req.$;
  res$ = res.$;

  // req/res decorations
  if (!req$) {
    var urlpath = req.url,
        qm = urlpath.indexOf('?'),
        path_,
        query_;
    if (qm > -1) {
      path_ = urlpath.substring(0, qm);
      if (qm === urlpath.length - 1)
        query_ = {};
      else
        query_ = qsparse(urlpath.substring(qm + 1));
    } else {
      path_ = urlpath;
      query_ = {};
    }

    req$ = req.$ = new Request(this, req, res, next, path_, query_);
    res$ = res.$ = new Response(this, req, res);
  }
  // end req/res decorations

  var pathname = req$.path;

  function next(err) {
    var method = req.method,
        handler,
        parent,
        curmw,
        error,
        keys,
        ret,
        m;

    if (err !== undefined && err !== null) {
      if (isError(err))
        error = err;
      else if (typeof err === 'string') {
        error = new Error(err);
        error.code = err.code || this.DEFAULT_ERROR_STATUS;
      } else if (typeof err === 'number' && err >= 400 && err < 600) {
        error = new Error(method
                          + ' '
                          + pathname
                          + ' '
                          + (STATUS_CODES[err] || 'Unknown Error'));
        error.code = err;
      } else {
        error = new Error(method + ' ' + pathname + ' Unknown Error');
        error.code = this.DEFAULT_ERROR_STATUS;
      }
    }

    for (; ptr < stacklen; ++ptr, paramPtr = 0) {
      curmw = stack[ptr];
      handler = curmw.handler;
      if (curmw.parent
          && (typeof handler === 'function' || handler.method === method)) {
        // optimized route handler
        parent = curmw.parent;
        if ((m = matched[parent.id]) === undefined)
          continue;
        curmw = parent;
      } else if (m = curmw.re.exec(pathname)) {
        // normal route handler
        matched[curmw.id] = m;
      } else
        continue;

      if (handlerMatches(handler, method, error))
        handler = (handler.handler || handler);
      else
        continue;

      // check for `router.param('foo', cb);` calls before calling route handler
      if ((keys = curmw.keys).length) {
        var resrc = curmw.re.toString(),
            skipHandler = false,
            paramKeys,
            params,
            lenk,
            pk,
            fn;

        req$.params = params = (paramsCache[resrc]
                                || (paramsCache[resrc] = makeParams(m, keys)));
        paramKeys = Object.keys(params);
        for (lenk = paramKeys.length, fn; paramPtr < lenk; ++paramPtr) {
          pk = paramKeys[paramPtr];
          if (fn = paramFuncs[pk]) {
            ++paramPtr;
            ret = execParam(fn, req, res, next, params[pk]);
            if (ret && isError(ret)) {
              if (!error)
                skipHandler = true;
              error = ret;
              break;
            }
            return;
          }
        }
        if (skipHandler)
          continue;
      } else
        req$.params = EMPTY_PARAMS;

      ++ptr;

      ret = execHandler(handler, req, res, next, error);
      if (ret && isError(ret))
        error = ret;
      return;
    }

    if (ptr === stacklen) {
      if (cb)
        cb(error);
      else if (error === undefined)
        res.end(method + ' ' + pathname + ' ' + STATUS_CODES[res.statusCode = 404]);
      else {
        res.statusCode = error.code;
        res.end(error.message);
      }
    }
  }

  next();
};

Router.prototype.DEFAULT_ERROR_STATUS = 500;

function execHandler(handler, req, res, next, error) {
  try {
    if (error === undefined)
      handler(req, res, next);
    else
      handler(error, req, res, next);
  } catch (ex) {
    ex.code = 500;
    return ex;
  }
}

function execParam(fn, req, res, next, val) {
  try {
    fn(req, res, next, val);
  } catch (ex) {
    ex.code = 500;
    return ex;
  }
}

function handlerMatches(handler, method, error) {
  var fn;

  if (typeof handler === 'function')
    fn = handler;
  else if (method === handler.method)
    fn = handler.handler;

  return (fn
          && ((error === undefined && fn.length < 4)
              || (error !== undefined && fn.length === 4)));
}

Router.prototype.use = function use(route) {
  var handlersEnd = arguments.length,
      handlersStart = 1,
      routes = route,
      method;

  // check for method-specific route, this is only the case when use() is called
  // internally from router.VERB()
  if (arguments.length > 2
      && typeof arguments[arguments.length - 1] === 'string') {
    method = arguments[arguments.length - 1].toUpperCase();
    --handlersEnd;
  }

  // match all routes by default when no path is given as the first argument
  if (typeof route === 'function' || route instanceof Router) {
    handlersStart = 0;
    routes = ROUTES_MATCH_ALL;
  }

  if (!Array.isArray(routes))
    routes = [ routes ];

  for (var i = 0, len = routes.length, fullPath, regex, keys; i < len; ++i) {
    if (isRegExp(routes[i])) {
      keys = NO_KEYS;
      regex = routes[i];
    } else {
      keys = [];
      if (routes === ROUTES_MATCH_ALL) {
        fullPath = this.path;
        regex = pathRegex(fullPath, keys, { end: false });
      } else {
        fullPath = urljoin(this.path, routes[i]);
        regex = pathRegex(fullPath, keys);
      }
    }

    for (var h = handlersStart; h < handlersEnd; ++h) {
      var handlerfn = arguments[h],
          handlerexpr = regex;
      if (typeof handlerfn !== 'function' && !(handlerfn instanceof Router))
        continue;
      else if (handlerfn instanceof Router) {
        if (keys === NO_KEYS)
          throw new Error('You must specify a string path when mounting a Router');
        else if (handlerfn._mounted)
          throw new Error('Cannot mount a Router in multiple places');
        if (routes !== ROUTES_MATCH_ALL)
          handlerexpr = pathRegex(fullPath, keys, { end: false });
        handlerfn.path = fullPath;
        handlerfn.config = this.config;
        handlerfn._mounted = true;
        handlerfn = handlerfn.handler;
      }

      if (!keys.length)
        keys = NO_KEYS;

      this._stack.push({
        id: this._rc++,
        re: handlerexpr,
        keys: keys,
        handler: (method ? { method: method, handler: handlerfn } : handlerfn)
      });
    }
  }

  this.optimize();

  return this;
};

Router.prototype.all = Router.prototype.use;

METHODS.forEach(function(method) {
  Router.prototype[method] = function methodRoute(route, handler) {
    var args = new Array(arguments.length + 1);
    for (var i = 0, len = args.length; i < len; ++i)
      args[i] = arguments[i];
    args[i] = method;
    return this.use.apply(this, args);    
  };
});

Router.prototype.param = function param(name, cb) {
  if (typeof name !== 'string')
    throw new Error('Param name is required');
  if (typeof cb === 'function')
    this._paramFuncs[name] = cb;
};

Router.prototype.route = function route(path, opts) {
  var router = new Router(opts);
  this.use(path, router);
  return router;
};

// optimize() finds route handlers with the same path and converts all but the
// first to "pointers" to the first. This allows us to skip repeated regexp
// execution, allowing for a significant speedup and more consistent performance
// when many route handlers for the same path are added
Router.prototype.optimize = function optimize() {
  var stack = this._stack,
      len = stack.length,
      layer,
      i;

  for (i = 0; i < len; ++i) {
    layer = stack[i];
    if (!layer.re) {
      // skip optimized handlers
      continue;
    }
    // check for a previous route handler that has the same path
    for (var p = 0; p < i; ++p) {
      if (!stack[p].re) {
        // again, skip optimized handlers
        continue;
      }
      if (regexpsEqual(layer.re, stack[p].re)) {
        // we found a previous route handler we can point to
        stack[i] = {
          parent: stack[p],
          handler: stack[i].handler
        };
      }
    }
  }
};

module.exports = Router;



function decodeParam(val) {
  if (typeof val !== 'string')
    return val;

  try {
    return decodeURIComponent(val);
  } catch (e) {
    return false;
  }
}

function makeParams(m, keys) {
  if (!keys)
    return (m && m.length > 1 && m.slice(1, m.length));
  else if (!m || (m && m.length <= 1))
    return;

  var params = {};

  for (var i = 1, len = m.length, key, val; i < len; ++i) {
    key = keys[i - 1];
    val = decodeParam(m[i]);
    if (val === false)
      params[key.name] = val;
    else
      params[key.name] = m[i];
  }

  return params;
}

function regexpsEqual(re1, re2) {
  return (re1.source === re2.source
          && re1.global === re2.global
          && re1.ignoreCase === re2.ignoreCase
          && re1.multiline === re2.multiline);
}
