var statSync = require('fs').statSync,
    path = require('path'),
    dirname = path.dirname,
    basename = path.basename,
    extname = path.extname,
    join = path.join,
    resolve = path.resolve;

var utils = require('./utils');

/**
 * Expose `View`.
 */

module.exports = View;

/**
 * Initialize a new `View` with the given `name`.
 *
 * Options:
 *
 *   - `defaultEngine` the default template engine name
 *   - `engines` template engine require() cache
 *   - `root` root path for view lookup
 *
 * @param {String} name
 * @param {Object} options
 * @api private
 */

function View(name, options) {
  var opts = options || {},
      engines = opts.engines,
      ext = extname(name);

  this.name = name;
  this.root = opts.root;
  this.defaultEngine = opts.defaultEngine;
  this.ext = ext;

  if (!ext && !this.defaultEngine)
    throw new Error('No default engine was specified and no extension was provided.');

  if (!ext) {
    ext = ('.' != this.defaultEngine[0] ? '.' : '') + this.defaultEngine;
    this.ext = ext;
    name += ext;
  }
  this.engine = engines[ext] || (engines[ext] = require(ext.slice(1)).__express);
  this.path = this.lookup(name);
}

/**
 * Lookup view by the given `name`
 *
 * @param {String} name
 * @return {String}
 * @api private
 */

View.prototype.lookup = function lookup(name) {
  var path,
      roots = [].concat(this.root);

  for (var i = 0, len = roots.length; i < len && !path; ++i) {
    var root = roots[i],
        loc = resolve(root, name),
        dir = dirname(loc),
        file = basename(loc);

    // resolve the file
    path = this.resolve(dir, file);
  }

  return path;
};

/**
 * Render with the given `options` and callback `fn(err, str)`.
 *
 * @param {Object} options
 * @param {Function} fn
 * @api private
 */

View.prototype.render = function render(options, fn) {
  this.engine(this.path, options, fn);
};

/**
 * Resolve the file within the given directory.
 *
 * @param {string} dir
 * @param {string} file
 * @private
 */

View.prototype.resolve = function resolve(dir, file) {
  var ext = this.ext,
      path,
      stat;

  // <path>.<ext>
  path = join(dir, file);
  stat = tryStat(path);

  if (stat && stat.isFile())
    return path;

  // <path>/index.<ext>
  path = join(dir, basename(file, ext), 'index' + ext);
  stat = tryStat(path);

  if (stat && stat.isFile())
    return path;
};

/**
 * Return a stat, maybe.
 *
 * @param {string} path
 * @return {fs.Stats}
 * @private
 */

function tryStat(path) {
  var stats;
  try {
    stats = statSync(path);
  } catch (e) {}
  return stats;
}
