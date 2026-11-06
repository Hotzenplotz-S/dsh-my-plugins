/**
 * MY-Plugin-Updates — 纯文本占位版：组件返回带文字的span确认渲染管线通
 * 不调用React hooks，只返回字符串
 */
export function apply(ctx) {
  return {
    id: 'my-plugin-updates',
    order: 10,
    label: () => ctx.text('meta.title'),
    component: () => {
      // 不调用任何 React API，返回纯字符串
      return '\u5F53\u524D\u72B6\u6001\uFF1A\u7EC4\u4EF6\u5DF2\u6E32\u67D3 (v1.0.0)';
    }
  }
}