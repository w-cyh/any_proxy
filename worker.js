/**
 * Cloudflare Worker - anyrouter.top 反向代理
 * 版本：ES Module (修复 Error 10216 + 修复死循环)
 */

const TARGET_HOST = 'anyrouter.top';
const TARGET_URL = `https://${TARGET_HOST}`;

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const workerDomain = url.host; // 获取你当前的域名 (比如 gpt.cyhwjx.xyz)
      const targetUrl = `${TARGET_URL}${url.pathname}${url.search}`;

      // 1. 构造请求头 (伪装身份)
      const headers = new Headers(request.headers);
      headers.set('Host', TARGET_HOST);
      headers.set('Referer', TARGET_URL);
      headers.set('Origin', TARGET_URL);
      headers.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      // 关键：删除 Accept-Encoding 以便我们能以文本方式读取和修改网页
      headers.delete('Accept-Encoding'); 

      // 2. 发起请求 (禁止自动跳转)
      const response = await fetch(targetUrl, {
        method: request.method,
        headers: headers,
        body: request.method !== 'GET' ? request.body : null,
        redirect: 'manual' 
      });

      // 3. 处理响应头
      const newHeaders = new Headers(response.headers);
      newHeaders.set('Access-Control-Allow-Origin', '*');
      newHeaders.delete('Content-Security-Policy');
      newHeaders.delete('X-Frame-Options');

      // === 补丁 1: 修复 Cookie 导致的死循环 ===
      const setCookie = newHeaders.get('Set-Cookie');
      if (setCookie) {
        // 移除 Cookie 中的 Domain 限制，让它在你的域名下也生效
        newHeaders.set('Set-Cookie', setCookie.replace(/Domain=[^;]+;/gi, ''));
      }

      // === 补丁 2: 处理 301/302 跳转 ===
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = newHeaders.get('Location');
        if (location) {
          // 把跳转地址里的 anyrouter.top 改成你的域名
          const newLocation = location.replace(TARGET_HOST, workerDomain);
          newHeaders.set('Location', newLocation);
          return new Response(null, { status: response.status, headers: newHeaders });
        }
      }

      // === 补丁 3: 网页内容清洗 (防 JS 强制跳转) ===
      const contentType = newHeaders.get('content-type') || '';
      if (contentType.includes('text/html')) {
        let body = await response.text();
        
        // A. 替换所有原域名链接
        body = body.replaceAll(TARGET_HOST, workerDomain);

        // B. 注入“麻醉剂”脚本 (防止网页 JS 发现域名不对而强制跳转)
        const antiRedirectScript = `
        <script>
          (function() {
            try {
              var originalLocation = window.location;
              // 冻结 window.location，让网页无法跳转
              Object.defineProperty(window, 'location', {
                get: function() { return originalLocation; },
                set: function(val) { console.log('拦截到强制跳转:', val); },
                configurable: true
              });
            } catch(e) {}
          })();
        </script>
        `;
        // 插在 <head> 标签里
        body = body.replace('<head>', '<head>' + antiRedirectScript);

        return new Response(body, { status: response.status, headers: newHeaders });
      }

      // 其他资源 (图片/视频) 直接返回
      return new Response(response.body, {
        status: response.status,
        headers: newHeaders
      });

    } catch (e) {
      return new Response('Proxy Error: ' + e.message, { status: 500 });
    }
  }
}
