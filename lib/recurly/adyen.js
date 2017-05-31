import Emitter from 'component-emitter';

const debug = require('debug')('recurly:adyen');

/**
 * Instantiation factory
 *
 * @param  {Object} options
 * @return {Adyen}
 */
export function factory (options) {
  return new Adyen(Object.assign({}, options, { recurly: this }));
};


/**
 * Initializes an Adyen session.
 *
 * @param {Object} options
 * @param {Recurly} options.recurly
 * @constructor
 * @public
 */

class Adyen extends Emitter {
  constructor (options) {
    debug('Creating new Adyen session');
    super();

    this.once('ready', () => this._ready = true);
    this.recurly = options.recurly
  }

/**
 * Invokes the Adyen Payment Modal
 * @param {Object} opts
 * @param {String} opts.invoiceUuid - invoice Uuid from PendingPurchase
 * @param {String} opts.countryCode - 2 Digit Country Code
 * @param {String} opts.shopperLocale - shopperLocale for Payment Modal
 * @param {String} opts.skinCode - Skin code provided by Adyen
*/

  start (opts) {
    debug('Invoking Adyen Modal');

    const payload = {
      invoiceUuid: opts.invoiceUuid,
      countryCode: opts.countryCode,
      shopperLocale: opts.shopperLocale,
      currencyCode: opts.currencyCode,
      skinCode: opts.skinCode
    };

    const frame = this.recurly.Frame({ height: 600, path: '/adyen/start', payload });
    frame.once('error', cause => this.error('adyen-error', { cause }));

    frame.once('done', token => this.emit('token', token));
  }
}
