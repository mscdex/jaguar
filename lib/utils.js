var mime = require('send').mime,
    etag = require('etag'),
    proxyaddr = require('proxy-addr'),
    qs = require('qs'),
    typer = require('media-typer');

var querystring = require('querystring');

/**
 * Return strong ETag for `body`.
 *
 * @param {String|Buffer} body
 * @param {String} [encoding]
 * @return {String}
 * @api private
 */

exports.etag = function _etag(body, encoding) {
  var buf = (!Buffer.isBuffer(body) ? new Buffer(body, encoding) : body);

  return etag(buf, {weak: false});
};

/**
 * Return weak ETag for `body`.
 *
 * @param {String|Buffer} body
 * @param {String} [encoding]
 * @return {String}
 * @api private
 */

exports.wetag = function wetag(body, encoding) {
  var buf = (!Buffer.isBuffer(body) ? new Buffer(body, encoding) : body);

  return etag(buf, {weak: true});
};

/**
 * Check if `path` looks absolute.
 *
 * @param {String} path
 * @return {Boolean}
 * @api private
 */

exports.isAbsolute = function isAbsolute(path) {
  if (path[0] === '/')
    return true;
  else if (path[1] === ':' && path[2] === '\\')
    return true;
  else if (path.substring(0, 2) === '\\\\')
    return true; // Microsoft Azure absolute path
};

/**
 * Flatten the given `arr`.
 *
 * @param {Array} arr
 * @return {Array}
 * @api private
 */

exports.flatten = function flatten(arr, result) {
  var ret = result || [];

  for (var i = 0, len = arr.length, val; i < len; ++i) {
    val = arr[i];
    if (Array.isArray(val))
      exports.flatten(val, ret);
    else
      ret.push(val);
  }

  return ret;
};

/**
 * Normalize the given `type`, for example "html" becomes "text/html".
 *
 * @param {String} type
 * @return {Object}
 * @api private
 */

exports.normalizeType = function normalizeType(type) {
  return (~type.indexOf('/')
          ? acceptParams(type)
          : { value: mime.lookup(type), params: {} });
};

/**
 * Normalize `types`, for example "html" becomes "text/html".
 *
 * @param {Array} types
 * @return {Array}
 * @api private
 */

exports.normalizeTypes = function normalizeTypes(types) {
  var ret = [];

  for (var i = 0, len = types.length; i < len; ++i)
    ret.push(exports.normalizeType(types[i]));

  return ret;
};

/**
 * Parse accept params `str` returning an
 * object with `.value`, `.quality` and `.params`.
 * also includes `.originalIndex` for stable sorting
 *
 * @param {String} str
 * @return {Object}
 * @api private
 */

var RE_ACCEPT_PARTS = / *; */,
    RE_ACCEPT_KV = / *= */;
function acceptParams(str, index) {
  var parts = str.split(RE_ACCEPT_PARTS),
      ret = { value: parts[0], quality: 1, params: {}, originalIndex: index };

  for (var i = 1, len = parts.length; i < len; ++i) {
    var pms = parts[i].split(RE_ACCEPT_KV);
    if (pms[0] === 'q')
      ret.quality = parseFloat(pms[1]);
    else
      ret.params[pms[0]] = pms[1];
  }

  return ret;
}

/**
 * Compile "etag" value to function.
 *
 * @param  {Boolean|String|Function} val
 * @return {Function}
 * @api private
 */

exports.compileETag = function compileETag(val) {
  var fn;

  if (typeof val === 'function')
    return val;

  switch (val) {
    case true:
      fn = exports.wetag;
      break;
    case false:
      break;
    case 'strong':
      fn = exports.etag;
      break;
    case 'weak':
      fn = exports.wetag;
      break;
    default:
      throw new TypeError('unknown value for etag function: ' + val);
  }

  return fn;
};

/**
 * Compile "query parser" value to function.
 *
 * @param  {String|Function} val
 * @return {Function}
 * @api private
 */

exports.compileQueryParser = function compileQueryParser(val) {
  var fn;

  if (typeof val === 'function')
    return val;

  switch (val) {
    case 'simple':
    case true:
      fn = querystring.parse;
      break;
    case false:
      fn = newObject;
      break;
    case 'extended':
      fn = qs.parse;
      break;
    default:
      throw new TypeError('unknown value for query parser function: ' + val);
  }

  return fn;
};

/**
 * Compile "proxy trust" value to function.
 *
 * @param  {Boolean|String|Number|Array|Function} val
 * @return {Function}
 * @api private
 */

var RE_TRUST_COMMA = / *, */,
    PROXYADDR_EMPTY = proxyaddr.compile([]);
exports.compileTrust = function compileTrust(val) {
  if (typeof val === 'function')
    return val;

  if (val === true) {
    // Support plain true/false
    return function() { return true; };
  }

  if (typeof val === 'number') {
    // Support trusting hop count
    return function(a, i) { return i < val; };
  }

  if (typeof val === 'string') {
    // Support comma-separated values
    val = val.split(RE_TRUST_COMMA);
  }

  return (val ? proxyaddr.compile(val) : PROXYADDR_EMPTY);
};

/**
 * Set the charset in a given Content-Type string.
 *
 * @param {String} type
 * @param {String} charset
 * @return {String}
 * @api private
 */

exports.setCharset = function setCharset(type, charset) {
  if (!type || !charset)
    return type;

  // parse type
  var parsed = typer.parse(type);

  // set charset
  parsed.parameters.charset = charset;

  // format type
  return typer.format(parsed);
};

/**
 * Return new empty objet.
 *
 * @return {Object}
 * @api private
 */

function newObject() {
  return {};
}
