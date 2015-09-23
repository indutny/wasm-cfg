'use strict';

var assertText = require('assert-text');
assertText.options.trim = true;
var fixtures = require('./fixtures');

// TODO(indutny): dev dependency
var wasmAST = require('wasm-ast');

var wasmCFG = require('../');

function test(source, expected) {
  var ast = wasmAST.parse(fixtures.fn2str(source), {
    index: true
  });
  var cfgs = wasmCFG.build(ast);

  var out = cfgs.map(function(cfg, index) {
    return cfg.render({ cfg: true }, 'printable')
              .replace(/pipeline/, 'pipeline ' + index);
  }).join('\n');

  assertText.equal(out, fixtures.fn2str(expected));
}

describe('wasm-cfg', function() {
  it('should construct linear CFG', function() {
    test(function() {/*
      i64 op(i64 a, i64 b) {
        return i64.mul(i64.add(a, b), b);
      }
    */}, function() {/*
      pipeline 0 {
        b0 {
          i0 = i64.param 0
          i1 = i64.param 1
          i2 = i64.add i0, i1
          i3 = i64.param 1
          i4 = i64.mul i2, i3
          i5 = i64.ret i4
        }
      }
    */});
  });
});
