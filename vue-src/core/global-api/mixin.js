/* @flow */

import { mergeOptions } from '../util/index'

/*初始化mixin*/
export function initMixin (Vue: GlobalAPI) {
    /*https://cn.vuejs.org/v2/api/#Vue-mixin*/
  Vue.mixin = function (mixin: Object) {
    // 全局混入mixin
    /*mergeOptions合并options*/
    this.options = mergeOptions(this.options, mixin)
  }
}
