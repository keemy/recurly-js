/**
 * dependencies
 */

var Emitter = require('emitter');
var index = require('indexof');
var each = require('each');
var type = require('type');
var bind = require('bind');
var find = require('find');
var mixin = require('mixin');
var keys = require('object.keys-shim');
var json = require('json');
var debug = require('debug')('recurly:pricing');
var PricingPromise = require('./promise');
var Calculations = require('./calculations');
var errors = require('../../errors');

/**
 * expose
 */

exports.Pricing = Pricing;

/**
 * subscription properties
 */

var PROPERTIES = [
    'plan'
  , 'addon'
  , 'coupon'
  , 'address'
  , 'currency'
];

/**
 * Pricing
 *
 * TODO
 *  - then/promise over callbacks?
 *
 * @constructor
 * @param {Recurly} recurly
 * @public
 */

function Pricing (recurly) {
  if (this instanceof require('../../recurly')) return new Pricing(this);
  this.recurly = recurly;
  this.reset();
}

Emitter(Pricing.prototype);

/**
 * Resets the pricing calculator
 *
 * @public
 */

Pricing.prototype.reset = function () {
  this.items = {};
  this.items.addons = [];
  this.currency(this.recurly.config.currency);
};

/**
 * Removes an object from the pricing model
 *
 * example
 *
 *   .remove({ plan: 'plan_code' });
 *   .remove({ addon: 'addon_code' });
 *   .remove({ coupon: 'coupon_code' });
 *   .remove({ address: true }); // to remove without specifying a code
 *
 * @param {Object} opts
 * @public
 */

Pricing.prototype.remove = function (opts) {
  var self = this;
  var item;
  debug('remove');

  return new PricingPromise(function (resolve, reject) {
    var id = opts[keys(opts)[0]];
    if (!~index(PROPERTIES, prop)) return reject(errors('invalid-item'));
    if (prop === 'addon') {
      var pos = index(self.items.addons, findAddon(self.items.addons, id));
      if (~pos) {
        item = self.items.addons.splice(pos);
      }
    } else if (self.items[prop] && (id === self.items[prop].code || id === true)) {
      item = self.items[prop]
      delete self.items[prop];
    } else {
      return reject(errors('unremovable-item', {
          type: prop
        , id: id
        , reason: 'does not exist on this pricing instance.'
      }));
    }
  }, this);
};

/**
 * Provides a subscription price estimate using current state
 *
 * @private
 */

Pricing.prototype.reprice = function () {
  var self = this;

  return new PricingPromise(function (resolve, reject) {
    if (!self.items.plan) return reject(errors('missing-plan'));

    Calculations(self, function (price) {
      if (json.stringify(price) === json.stringify(self.price)) return resolve(price);
      self.price = price;
      self.emit('change', price);
      resolve(price);
    });
  }, this);
};

/**
 * Updates plan
 *
 * @param {String} planCode
 * @private
 */

Pricing.prototype.plan = function (planCode) {
  var self = this;
  var plan = this.items.plan;

  return new PricingPromise(function (resolve, reject) {
    if (plan && plan.code === planCode) return resolve(plan);
    self.recurly.plan(planCode, function (err, plan) {
      if (err) return reject(err);

      self.items.plan = plan;

      if (!(self.items.currency in plan.price)) {
        self.currency(keys(plan.price)[0]);
      }

      debug('set.plan`');
      self.emit('set.plan', plan);
      resolve(plan);
    });
  }, this);
};

/**
 * Updates addon
 *
 * @param {String} addonCode
 * @param {Object} meta
 * @param {Number} meta.quantity
 * @private
 */

Pricing.prototype.addon = function (addonCode, meta) {
  var self = this;

  return new PricingPromise(function (resolve, reject) {
    if (!self.items.plan) return reject(errors('missing-plan'));

    var planAddon = findAddon(self.items.plan.addons, addonCode);
    if (!planAddon) {
      return reject(errors('invalid-addon', {
          planCode: self.items.plan.code
        , addonCode: addonCode
      }));
    }

    var quantity = addonQuantity(meta, planAddon);
    var addon = findAddon(self.items.addons, addonCode);

    if (isNaN(quantity) || quantity === 0) {
      self.remove({ addon: addonCode });
    }

    if (addon) {
      addon.quantity = quantity;
    } else {
      var addon = json.parse(json.stringify(planAddon));
      addon.quantity = quantity;
      self.items.addons.push(addon);
    }

    debug('set.addon');
    self.emit('set.addon', addon);
    resolve(addon);
  }, this);
};

/**
 * Updates coupon
 *
 * @param {String} couponCode
 * @param {Object} meta
 * @private
 */

Pricing.prototype.coupon = function (couponCode, meta) {
  var self = this;
  var coupon = this.items.coupon;

  return new PricingPromise(function (resolve, reject) {
    if (!self.items.plan) return reject(errors('missing-plan'));
    if (!couponCode) return resolve();
    if (coupon) {
      if (coupon.code === couponCode) return resolve(coupon);
      else self.remove({ coupon: coupon.code });
    }

    self.recurly.coupon({ plan: self.items.plan.code, coupon: couponCode }, function (err, coupon) {
      if (err) return reject(err);

      self.items.coupon = coupon;

      debug('set.coupon');
      self.emit('set.coupon', coupon);
      resolve(coupon);
    });
  }, this);
};

/**
 * Updates address
 *
 * @param {Object} address
 * @param {String} address.country
 * @param {String|Number} address.postal_code
 * @param {Object} meta
 * @private
 */

Pricing.prototype.address = function (address, meta) {
  var self = this;

  return new PricingPromise(function (resolve, reject) {
    if (json.stringify(address) === json.stringify(self.items.address)) {
      return resolve(self.items.address);
    }

    self.items.address = address;

    debug('set.address');
    self.emit('set.address', address);
    resolve(address);
  }, this);
};

/**
 * Updates or retrieves currency code
 *
 * @param {String} code
 * @param {Object} meta
 * @private
 */

Pricing.prototype.currency = function (code, meta) {
  var self = this;
  var plan = this.items.plan
  var currency = this.items.currency;

  return new PricingPromise(function (resolve, reject) {
    if (currency === code) return resolve(currency);
    if (plan && !(code in plan.price)) {
      return reject(errors('invalid-currency', {
          currencyCode: code
        , planCurrencies: keys(plan.price)
      }));
    }

    self.items.currency = code;

    debug('set.currency');
    self.emit('set.currency', code);
    resolve(code);
  }, this);
};

/**
 * DOM binding mixin
 */

mixin(Pricing.prototype, require('./binding'));

/**
 * Utility functions
 */

function addonQuantity (meta, planAddon) {
  var qty = meta.quantity !== undefined
    ? meta.quantity
    : planAddon.quantity !== undefined
      ? planAddon.quantity
      : 1;

  return parseInt(qty, 10);
}

function findAddon (addons, code) {
  return addons && find(addons, { code: code });
}