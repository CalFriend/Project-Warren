/* Account-specific configuration is set in Apps Script's Script properties. */
var WarrenConfig = (function () {
  'use strict';
  function setting(name) {
    var value = PropertiesService.getScriptProperties().getProperty('WARREN_' + name);
    if (value === null) return '';
    // The service historically saved its folder ID as a JSON string.
    value = value.trim();
    if (value.charAt(0) === '"') value = JSON.parse(value);
    if (typeof value !== 'string') throw Error('WARREN_' + name + '_INVALID');
    return value.trim();
  }
  function email(name, required) {
    var value = setting(name);
    if (!value && required) throw Error('WARREN_' + name + '_REQUIRED');
    if (value && !/^[^\s,@;<>"]+@[^\s,@;<>"]+\.[^\s,@;<>"]+$/.test(value))
      throw Error('WARREN_' + name + '_INVALID');
    return value.toLowerCase();
  }
  function checkOwner() {
    var owner = email('OWNER_EMAIL', true);
    if (String(Session.getEffectiveUser().getEmail()).toLowerCase() !== owner) throw Error('WARREN_WRONG_ACCOUNT');
  }
  function mail() {
    return {recipient:email('RECIPIENT_EMAIL',true),name:setting('SENDER_NAME') || 'Project Warren',replyTo:email('REPLY_TO',false)};
  }
  function rootId(required) {
    var value = setting('ROOT');
    if (!value && required) throw Error('WARREN_ROOT_REQUIRED');
    return value;
  }
  return {setting:setting, checkOwner:checkOwner, mail:mail, rootId:rootId};
})();
