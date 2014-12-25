var isIP = require('net').isIP;

var typeis = require('type-is'),
    fresh = require('fresh'),
    parseRange = require('range-parser'),
    parse = require('parseurl'),
    proxyaddr = require('proxy-addr');

var RE_COMMA_SPLIT = /\s*,\s*/;

function Request(router, req, res, next, path_, query_) {
  this.router = router;
  this.path = path_;
  this.query = query_;
  this.params = undefined;
  this.body = undefined;
  this.req = req;
  this.res = res;
  this.next = next;

  this.data = {};
}

Request.prototype.get =
Request.prototype.header = function(name) {
  return this.req.headers[name.toLowerCase()];
};

Request.prototype.accepts = function() {
  var accept = accepts(this.req);
  return accept.types.apply(accept, arguments);
};

Request.prototype.acceptsEncodings = function() {
  var accept = accepts(this.req);
  return accept.encodings.apply(accept, arguments);
};

Request.prototype.acceptsCharsets = function() {
  var accept = accepts(this.req);
  return accept.charsets.apply(accept, arguments);
};

Request.prototype.acceptsLanguages = function() {
  var accept = accepts(this.req);
  return accept.languages.apply(accept, arguments);
};

Request.prototype.range = function(size) {
  var range = this.req.headers.range;
  if (!range)
    return;
  return parseRange(size, range);
};

Request.prototype.param = function(name, defaultVal) {
  var params = this.params,
      body = this.body,
      query = this.query,
      val;
  if (params && (val = params[name]))
    return val;
  if (body && (val = body[name]))
    return val;
  if (query && (val = query[name]))
    return val;
  return defaultVal;
};

Request.prototype.is = function(types) {
  var list = types;
  if (!Array.isArray(list)) {
    list = new Array(arguments.length);
    for (var i = 0, len = list.length; i < len; ++i)
      list[i] = arguments[i];
  }
  return typeis(this.req, list);
};

defineGetter(Request.prototype, 'protocol', function protocol() {
  var proto = (this.req.socket.encrypted ? 'https' : 'http'),
      trust = this.router.config['trust proxy fn'];

  if (!trust(this.req.socket.remoteAddress))
    return proto;

  // Note: X-Forwarded-Proto is normally only ever a
  //       single value, but this is to be safe.
  proto = this.req.headers['x-forwarded-proto'] || proto;
  return proto.split(RE_COMMA_SPLIT)[0];
});

defineGetter(Request.prototype, 'secure', function secure() {
  return (this.protocol === 'https');
});

defineGetter(Request.prototype, 'ip', function ip() {
  return proxyaddr(this.req, this.router.config['trust proxy fn']);
});

defineGetter(Request.prototype, 'ips', function ips() {
  var addrs = proxyaddr.all(this.req, this.router.config['trust proxy fn']);
  return addrs.slice(1).reverse();
});

defineGetter(Request.prototype, 'subdomains', function subdomains() {
  var hostname = this.hostname;

  if (!hostname)
    return [];

  var subdomains = (!isIP(hostname)
                    ? hostname.split('.').reverse()
                    : [hostname]);

  return subdomains.slice(this.router.config['subdomain offset']);
});

defineGetter(Request.prototype, 'path', function path() {
  return parse(this.req).pathname;
});

defineGetter(Request.prototype, 'hostname', function hostname() {
  var host = this.req.headers['x-forwarded-host'];

  if (!host || !this.router.config['trust proxy fn'](this.req.socket.remoteAddress))
    host = this.req.headers.host;

  if (!host)
    return;

  // IPv6 literal support
  var offset = (host[0] === '[' ? host.indexOf(']') + 1 : 0),
      index = host.indexOf(':', offset);

  return (~index ? host.substring(0, index) : host);
});

defineGetter(Request.prototype, 'fresh', function() {
  var method = this.req.method,
      s = this.res.statusCode;

  // GET or HEAD for weak freshness validation only
  if (method !== 'GET' && method !== 'HEAD')
    return false;

  // 2xx or 304 as per rfc2616 14.26
  if ((s >= 200 && s < 300) || s === 304)
    return fresh(this.req.headers, this.res._headers || {});

  return false;
});

defineGetter(Request.prototype, 'stale', function stale() {
  return !this.fresh;
});

defineGetter(Request.prototype, 'xhr', function xhr() {
  var val = (this.req.headers['x-requested-with'] || '').toLowerCase();
  return (val === 'xmlhttprequest');
});

function defineGetter(obj, name, getter) {
  Object.defineProperty(obj, name, {
    configurable: true,
    enumerable: true,
    get: getter
  });
};


module.exports = Request;
