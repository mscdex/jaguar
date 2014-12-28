var http = require('http'),
    STATUS_CODES = http.STATUS_CODES,
    extname = require('path').extname,
    resolve = require('path').resolve,
    isArray = Array.isArray;

var contentDisposition = require('content-disposition'),
    escapeHtml = require('escape-html'),
    onFinished = require('on-finished'),
    merge = require('utils-merge'),
    sign = require('cookie-signature').sign,
    cookieSerialize = require('cookie').serialize,
    send = require('send'),
    mime = send.mime,
    vary = require('vary');

var isAbsolute = require('./utils').isAbsolute,
    normalizeType = require('./utils').normalizeType,
    normalizeTypes = require('./utils').normalizeTypes,
    setCharset = require('./utils').setCharset;

var RE_CHARSET = /[^\[\]\w$.]/g,
    RE_CHARSET2 = /;\s*charset\s*=/,
    RE_JSON_CHAR1 = /\u2028/g,
    RE_JSON_CHAR2 = /\u2029/g,
    EXPIRED = new Date(1);

function Response(router, req, res) {
  this.router = router;
  this.req = req;
  this.res = res;
  this.charset = undefined;
  this.locals = Object.create(null);
}

Response.prototype.status = function status(code) {
  this.res.statusCode = code;
};

Response.prototype.links = function _links(links_) {
  // `links` can be a string, object, or an array of strings and/or objects

  var val = this.res.getHeader('Link') || '',
      links = links_;
  if (!isArray(links))
    links = [links];

  for (var i = 0, len = links.length, link; i < len; ++i) {
    link = links[i];
    if (typeof link === 'string') {
      if (val)
        val += ', <';
      else
        val += '<';
      val += link;
      val += '>';
    } else {
      if (val)
        val += ', <';
      else
        val += '<';
      val += link.url;
      val += '>';
      var keys = Object.keys(link);
      for (var k = 0, klen = keys.length, param; k < klen; ++k) {
        param = keys[k];
        if (param.toLowerCase() !== 'url') {
          val += '; '
          val += param;
          val += '=';
          if (param[param.length - 1] === '*')
            val += link[param];
          else {
            val += '"';
            val += link[param];
            val += '"';
          }
        }
      }
    }
  }

  if (val)
    this.res.setHeader('Link', val);

  return this;
};

Response.prototype.send = function send(status, body) {
  var config = this.router.config,
      req = this.req,
      res = this.res,
      chunk = body,
      encoding,
      type,
      len;

  if (arguments.length === 1)
    chunk = status;
  else
    res.statusCode = status;

  // disambiguate res.send(status) and res.send(status, num)
  if (typeof chunk === 'number' && arguments.length === 1) {
    // res.send(status) will set status message as text string
    if (!res.getHeader('Content-Type'))
      this.type('txt');

    res.statusCode = chunk;
    chunk = STATUS_CODES[chunk];
  }

  switch (typeof chunk) {
    // string defaulting to html
    case 'string':
      if (!res.getHeader('Content-Type'))
        this.type('html');
      break;
    case 'boolean':
    case 'number':
    case 'object':
      if (chunk === null)
        chunk = '';
      else if (Buffer.isBuffer(chunk)) {
        if (!res.getHeader('Content-Type'))
          this.type('bin');
      } else
        return this.json(chunk);
      break;
  }

  // write strings in utf-8
  if (typeof chunk === 'string') {
    encoding = 'utf8';
    type = res.getHeader('Content-Type');

    // reflect this in content-type
    if (typeof type === 'string')
      res.setHeader('Content-Type', setCharset(type, 'utf-8'));
  }

  // populate Content-Length
  if (chunk !== undefined) {
    if (!Buffer.isBuffer(chunk)) {
      // convert chunk to Buffer; saves later double conversions
      chunk = new Buffer(chunk, encoding);
      encoding = undefined;
    }

    len = chunk.length;
    res.setHeader('Content-Length', len);
  }

  // method check
  var isHead = (req.method === 'HEAD');

  // ETag support
  if (len !== undefined && (isHead || req.method === 'GET')) {
    var etag = config['etag fn'];
    if (etag && !res.getHeader('ETag')) {
      etag = etag(chunk, encoding);
      etag && res.setHeader('ETag', etag);
    }
  }

  // freshness
  if (req.$.fresh)
    res.statusCode = 304;

  // strip irrelevant headers
  if (res.statusCode === 204 || res.statusCode === 304) {
    res.removeHeader('Content-Type');
    res.removeHeader('Content-Length');
    res.removeHeader('Transfer-Encoding');
    chunk = '';
  }

  if (isHead) {
    // skip body for HEAD
    res.end();
  } else {
    // respond
    res.end(chunk, encoding);
  }

  return this;
};

Response.prototype.json = function json(status, obj) {
  var val = obj;

  if (arguments.length === 1)
    val = status;
  else
    this.res.statusCode = status;

  // settings
  var config = this.router.config,
      replacer = config['json replacer'],
      spaces = config['json spaces'],
      body = JSON.stringify(val, replacer, spaces);

  // content-type
  if (!this.res.getHeader('Content-Type'))
    this.res.setHeader('Content-Type', 'application/json');

  return this.send(body);
};

Response.prototype.jsonp = function jsonp(status, obj) {
  var req = this.req,
      res = this.res,
      val = obj;

  if (arguments.length === 1)
    val = status;
  else
    res.statusCode = status;

  // settings
  var config = this.router.config,
      replacer = config['json replacer'],
      spaces = config['json spaces'],
      body = JSON.stringify(val, replacer, spaces),
      callback = req.$.query[config['jsonp callback name']];

  // content-type
  if (!res.getHeader('Content-Type')) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', 'application/json');
  }

  // fixup callback
  if (Array.isArray(callback))
    callback = callback[0];

  // jsonp
  if (typeof callback === 'string' && callback.length !== 0) {
    res.$.charset = 'utf-8';
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', 'text/javascript');

    // restrict callback charset
    callback = callback.replace(RE_CHARSET, '');

    // replace chars not allowed in JavaScript that are in JSON
    body = body.replace(RE_JSON_CHAR1, '\\u2028')
               .replace(RE_JSON_CHAR2, '\\u2029');

    // the /**/ is a specific security mitigation for "Rosetta Flash JSONP abuse"
    // the typeof check is just to reduce client error noise
    body = '/**/ typeof '
           + callback
           + ' === \'function\' && '
           + callback
           + '('
           + body
           + ');';
  }

  return this.send(body);
};

Response.prototype.sendStatus = function sendStatus(code) {
  var body = STATUS_CODES[code] || String(code);

  this.res.statusCode = code;
  this.type('txt');

  return this.send(body);
};

Response.prototype.sendFile = function sendFile(path, options, fn) {
  var req = this.req,
      res = this.res,
      next = req.$.next,
      opts;

  if (!path)
    throw new TypeError('path argument is required to res.sendFile');

  // support function as second arg
  if (typeof options === 'function') {
    fn = options;
    opts = {};
  } else
    opts = options || {};

  if (!opts.root && !isAbsolute(path))
    throw new TypeError('path must be absolute or specify root to res.sendFile');

  // create file stream
  var pathname = encodeURI(path),
      file = send(req, pathname, opts);

  // transfer
  sendfile(res, file, opts, function(err) {
    if (fn)
      fn(err);
    else if (err && err.code === 'EISDIR')
      next();
    // next() all but write errors
    else if (err && err.code !== 'ECONNABORT' && err.syscall !== 'write')
      next(err);
  });
};

Response.prototype.download = function download(path, filename, fn) {
  var file;

  // support function as second arg
  if (typeof filename === 'function')
    fn = filename;
  else
    file = filename || path;

  // set Content-Disposition when file is sent
  var opts = {
    headers: {
      'Content-Disposition': contentDisposition(file)
    }
  };

  // Resolve the full path for sendFile
  var fullPath = resolve(path);

  return this.sendFile(fullPath, opts, fn);
};

Response.prototype.contentType =
Response.prototype.type = function(type) {
  var val = (~type.indexOf('/') ? type : mime.lookup(type));
  return this.res.setHeader('Content-Type', val);
};

Response.prototype.format = function(obj) {
  var req = this.req,
      next = req.$.next;

  var fn = obj.default;

  if (fn)
    delete obj.default;

  var keys = Object.keys(obj),
      key = req.$.accepts(keys);

  this.vary('Accept');

  if (key) {
    this.set('Content-Type', normalizeType(key).value);
    obj[key](req, this, next);
  } else if (fn)
    fn();
  else {
    var err = new Error('Not Acceptable'),
        types = normalizeTypes(keys);
    err.status = 406;
    for (var i = 0, len = types.length; i < len; ++i)
      types[i] = types[i].value;
    err.types = types;
    next(err);
  }

  return this;
};

Response.prototype.attachment = function attachment(filename) {
  if (filename)
    this.type(extname(filename));

  this.res.setHeader('Content-Disposition', contentDisposition(filename));

  return this;
};

Response.prototype.set =
Response.prototype.header = function header(field, val) {
  var key,
      len,
      i;

  if (arguments.length === 2) {
    if (Array.isArray(val)) {
      for (i = 0, len = val.length; i < len; ++i)
        val[i] += '';
    } else
      val += '';
    if (field.toLowerCase() === 'content-type' && !RE_CHARSET2.test(val)) {
      var idx = val.indexOf(';'),
          charset;

      if (~idx)
        charset = mime.charsets.lookup(val.substring(0, idx));
      else
        charset = mime.charsets.lookup(val);

      if (charset) {
        val += '; charset=';
        val += charset.toLowerCase();
      }
    }
    this.res.setHeader(field, val);
  } else {
    var keys = Object.keys(field);
    for (i = 0, len = keys.length; i < len; ++i) {
      key = keys[i];
      this.set(key, field[key]);
    }
  }
  return this;
};

Response.prototype.get = function get(field) {
  return this.res.getHeader(field);
};

Response.prototype.clearCookie = function clearCookie(name, options) {
  var opts = { expires: EXPIRED, path: '/' },
      opts_ = (options ? merge(opts, options) : opts);

  return this.cookie(name, '', opts_);
};

Response.prototype.cookie = function cookie(name, val, options) {
  var opts = merge({}, options),
      secret = this.req.$.secret,
      signed = opts.signed,
      value;

  if (signed && !secret)
    throw new Error('cookieParser("secret") required for signed cookies');

  if (typeof val === 'number')
    value = val.toString();
  else if (typeof val === 'object')
    value = 'j:' + JSON.stringify(val);

  if (signed)
    value = 's:' + sign(val, secret);

  if (opts.maxAge) {
    opts.expires = new Date(Date.now() + opts.maxAge);
    opts.maxAge /= 1000;
  }

  if (!opts.path)
    opts.path = '/';

  var headerVal = cookieSerialize(name, '' + value, opts);

  // supports multiple 'res.cookie' calls by getting previous value
  var prev = this.res.getHeader('Set-Cookie');
  if (prev) {
    if (Array.isArray(prev))
      headerVal = prev.concat(headerVal);
    else
      headerVal = [prev, headerVal];
  }

  this.res.setHeader('Set-Cookie', headerVal);
  return this;
};

Response.prototype.location = function location(url) {
  // "back" is an alias for the referrer
  if (url === 'back')
    url = (this.req.getHeader('Referrer') || '/');

  // Respond
  this.res.setHeader('Location', url);
  return this;
};

Response.prototype.redirect = function redirect(url) {
  var res = this.ret,
      address = url,
      status = 302,
      body;

  // allow status / url
  if (arguments.length === 2) {
    if (typeof arguments[0] === 'number') {
      status = arguments[0];
      address = arguments[1];
    } else
      status = arguments[1];
  }

  // Set location header
  this.location(address);
  address = res.getHeader('Location');

  // Support text/{plain,html} by default
  this.format({
    text: function() {
      body = STATUS_CODES[status];
      body += '. Redirecting to ';
      body += encodeURI(address);
    },

    html: function() {
      var u = escapeHtml(address);
      body = '<p>';
      body += STATUS_CODES[status];
      body += '. Redirecting to <a href="';
      body += u;
      body += '">';
      body += u;
      body += '</a></p>';
    },

    default: function() {
      body = '';
    }
  });

  // Respond
  res.statusCode = status;
  res.setHeader('Content-Length', Buffer.byteLength(body));

  if (this.req.method === 'HEAD')
    res.end();
  else
    res.end(body);
};

Response.prototype.vary = function _vary(field) {
  // checks for back-compat
  if (!field || (Array.isArray(field) && !field.length))
    return this;

  vary(this.res, field);

  return this;
};

Response.prototype.render = function _render(name, options, fn) {
  var opts = options || {},
      self = this,
      router = this.router,
      config = router.config,
      cache = router.cache,
      engines = router.engines,
      view;

  // support callback function as second arg
  if (typeof options === 'function') {
    fn = options;
    opts = {};
  }

  // merge app.locals
  merge(opts, router.locals);

  // merge res.locals
  opts._locals = this.locals;

  // default callback to respond
  fn = fn || function(err, str) {
    if (err)
      return self.req.$.next(err);
    self.send(str);
  };

  // set .cache unless explicitly provided
  opts.cache = (opts.cache == null
                ? config['view cache']
                : opts.cache);

  // primed cache
  if (opts.cache)
    view = cache[name];

  // view
  if (!view) {
    view = new (config['view'])(name, {
      defaultEngine: config['view engine'],
      root: config['views'],
      engines: engines
    });

    if (!view.path) {
      var root = view.root,
          dirs = (isArray(root) && root.length > 1
                  ? 'directories "'
                    + root.slice(0, -1).join('", "')
                    + '" or "'
                    + root[root.length - 1]
                    + '"'
                  : 'directory "'
                    + root
                    + '"'),
          err = new Error('Failed to lookup view "'
                          + name
                          + '" in views '
                          + dirs);
      err.view = view;
      return fn(err);
    }

    // prime the cache
    if (opts.cache)
      cache[name] = view;
  }

  tryRender(view, opts, fn);
};

function tryRender(view, options, fn) {
  try {
    view.render(options, fn);
  } catch (err) {
    fn(err);
  }
}

function sendfile(res, file, options, callback) {
  var done = false;

  // directory
  function ondirectory() {
    if (done)
      return;
    done = true;

    var err = new Error('EISDIR, read');
    err.code = 'EISDIR';
    callback(err);
  }

  // errors
  function onerror(err) {
    if (done)
      return;
    done = true;

    callback(err);
  }

  // ended
  function onend() {
    if (done)
      return;
    done = true;

    callback();
  }

  // finished
  function onfinish(err) {
    if (err)
      return onerror(err);
    else if (done)
      return;

    setImmediate(function () {
      if (done)
        return;
      done = true;

      // response finished before end of file
      var err = new Error('Request aborted');
      err.code = 'ECONNABORT';
      callback(err);
    });
  }

  file.on('end', onend);
  file.on('error', onerror);
  file.on('directory', ondirectory);
  onFinished(res, onfinish);

  if (options.headers) {
    // set headers on successful transfer
    file.on('headers', function headers(res) {
      var obj = options.headers,
          keys = Object.keys(obj);

      for (var i = 0, len = keys.length, k; i < len; ++i) {
        k = keys[i];
        res.setHeader(k, obj[k]);
      }
    });
  }

  // pipe
  file.pipe(res);
}

module.exports = Response;
