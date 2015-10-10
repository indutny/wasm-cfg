'use strict';

exports.EFFECT_NONE = 0;
exports.EFFECT_MEMORY_LOAD = 1;
exports.EFFECT_MEMORY_STORE = 2;
exports.EFFECT_MEMORY_RESIZE = 4;
exports.EFFECT_CALL = 8 |
                      exports.EFFECT_MEMORY_STORE |
                      exports.EFFECT_MEMORY_RESIZE;
exports.EFFECT_NO_UPDATE_MASK = exports.EFFECT_MEMORY_LOAD;
