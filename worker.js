/**
 * Cloudflare Worker - anyrouter.top 反向代理 (ES Module 版 + 详细日志)
 *
 * 功能说明：
 * 1. 接收所有请求并转发到 anyrouter.top
 * 2. 保持原始请求的所有 headers、方法和 body
 * 3. 自动重写 HTML/CSS/JS 中的绝对 URL
 * 4. 返回目标网站的响应
 * 5. 记录详细的请求和响应日志（包括内容）
 */

// 目标网站地址
const TARGET_HOST = 'anyrouter.top';
const TARGET_URL = `https://${TARGET_HOST}`;

// 日志大小限制（KB）
const MAX_LOG_SIZE = 100;

export default {
  async fetch(request, env, ctx) {
    try {
      // 解析请求的 URL
      const url = new URL(request.url);

      // 调试信息
      console.log('=== 收到新请求 ===');
      console.log('请求URL:', request.url);
      console.log('请求方法:', request.method);

      // 记录请求头
      console.log('\n--- 请求 Headers ---');
      const headers = new Headers(request.headers);
       console.log(`${headers}`);
      // headers.forEach((value, key) => {
      //   console.log(`${key}: ${value}`);
      // });

      // 构建目标 URL，保持原始路径和查询参数
      const targetUrl = `${TARGET_URL}${url.pathname}${url.search}`;
      // console.log('\n--- 目标信息 ---');
      console.log('目标URL:', targetUrl);

      // 复制请求头，并修改 Host 和 Origin
      headers.set('Host', TARGET_HOST);
      
      // 关键：删除 Accept-Encoding 以便我们能以文本方式读取和修改网页（防止乱码）
      headers.delete('Accept-Encoding'); 

      // 如果存在 Origin，也需要修改
      if (headers.has('Origin')) {
        headers.set('Origin', TARGET_URL);
      }

      // 如果存在 Referer，也需要修改
      if (headers.has('Referer')) {
        const referer = headers.get('Referer');
        try {
          const refererUrl = new URL(referer);
          headers.set('Referer', `${TARGET_URL}${refererUrl.pathname}${refererUrl.search}`);
        } catch (e) {
          // 如果 Referer 格式错误，保持不变
        }
      }

      // 构建新的请求选项
      const requestOptions = {
        method: request.method,
        headers: headers,
        redirect: 'manual',  // 不自动跟随重定向，避免重定向循环
      };

      // 如果请求有 body（POST、PUT 等），需要复制 body
      let requestBody = null;
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        try {
          // 读取请求体
          requestBody = await request.clone().arrayBuffer();
          console.log('\n--- 请求 Body ---');

          // 尝试以文本形式显示请求体
          try {
            const bodyText = new TextDecoder().decode(requestBody);
            const bodyLength = bodyText.length;
            console.log(`Body长度: ${bodyLength} 字符`);

            // 限制日志输出大小
            if (bodyLength > MAX_LOG_SIZE * 1024) {
              console.log(`Body内容 (前 ${MAX_LOG_SIZE}KB):`);
              console.log(bodyText.substring(0, MAX_LOG_SIZE * 1024));
              console.log('... (内容过长，已截断)');
            } else {
              console.log(`Body内容:\n${bodyText}`);
            }
          } catch (e) {
            // 如果解码失败，可能是二进制数据
            console.log('Body为二进制数据，长度:', requestBody.byteLength, '字节');
            console.log('Body (Hex, 前200字符):', arrayBufferToHex(requestBody).substring(0, 200));
          }

          requestOptions.body = requestBody;
        } catch (e) {
          console.log('无法读取请求体:', e.message);
        }
      }

      // 发起代理请求
      console.log('\n--- 发起代理请求 ---');
      const response = await fetch(targetUrl, requestOptions);
      console.log('目标响应状态:', response.status, response.statusText);

      // 准备响应头
      const responseHeaders = new Headers(response.headers);
      
      // 添加 CORS 支持
      responseHeaders.set('Access-Control-Allow-Origin', '*');
      responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      responseHeaders.set('Access-Control-Allow-Headers', '*');

      // 删除可能导致问题的安全头
      responseHeaders.delete('Content-Security-Policy');
      responseHeaders.delete('X-Frame-Options');

      // 手动处理重定向状态码 (核心防死循环补丁)
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('Location');
        console.log('\n--- 重定向检测 ---');
        console.log('检测到重定向，Location:', location);

        if (location) {
          // 如果重定向回原网站，强行改成代理域名
          if (location.includes(TARGET_HOST)) {
             const newLocation = location.replace(TARGET_HOST, url.host); // url.host 是当前 Worker 域名
             console.log('重写重定向地址为:', newLocation);
             responseHeaders.set('Location', newLocation);
             return new Response(null, {
               status: response.status,
               statusText: response.statusText,
               headers: responseHeaders
             });
          }
          // 如果是相对路径，不需要改，直接返回
        }
      }

      // 获取响应内容类型
      const contentType = responseHeaders.get('content-type') || '';
      console.log('\n--- 响应 Headers ---');
       console.log(`${responseHeaders}`)
      // responseHeaders.forEach((value, key) => {
      //   console.log(`${key}: ${value}`);
      // });

      // 检查是否是文本内容类型（只有这些才需要 URL 重写）
      const isTextContent =
        contentType.includes('text/html') ||
        contentType.includes('text/javascript') ||
        contentType.includes('application/javascript') ||
        contentType.includes('application/x-javascript') ||
        contentType.includes('text/css') ||
        contentType.includes('application/json') ||
        contentType.includes('text/xml') ||
        contentType.includes('application/xml');

      // 如果是文本内容，需要重写其中的 URL
      if (isTextContent) {
        try {
          console.log('\n--- 响应 Body (文本内容) ---');
          console.log('尝试读取文本内容...');
          const text = await response.text();
          const contentLength = text.length;
          console.log(`内容长度: ${contentLength} 字符`);

          // 限制日志输出大小
          if (contentLength > MAX_LOG_SIZE * 1024) {
            console.log(`内容预览 (前 ${MAX_LOG_SIZE}KB):`);
            console.log(text.substring(0, MAX_LOG_SIZE * 1024));
            console.log('... (内容过长，已截断)');
          } else {
            console.log(`内容预览:\n${text.substring(0, 1000)}${contentLength > 1000 ? '\n... (内容过长已截断显示前1000字符)' : ''}`);
          }

          const rewrittenText = rewriteUrlsInContent(text, request.url, TARGET_URL);
          console.log('\n--- URL 重写完成 ---');
          
          // 注入防跳转脚本 (麻醉剂)
          // 这一步必须有，否则你的日志虽然完美，但网页一打开就会跳走
          let finalBody = rewrittenText;
          if (contentType.includes('text/html')) {
             const antiRedirectScript = `
                <script>
                  (function() {
                    try {
                      var originalLocation = window.location;
                      Object.defineProperty(window, 'location', {
                        get: function() { return originalLocation; },
                        set: function(val) { console.log('拦截跳转:', val); },
                        configurable: true
                      });
                    } catch(e) {}
                  })();
                </script>
             `;
             finalBody = finalBody.replace('<head>', '<head>' + antiRedirectScript);
          }

          return new Response(finalBody, {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders
          });
        } catch (error) {
          // 如果文本转换失败，直接返回原始响应
          console.error('\n!!! 文本转换失败 !!!');
          console.error('错误消息:', error.message);
          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders
          });
        }
      }

      // 对于二进制文件（图片、视频等），直接返回原始响应
      console.log('\n--- 响应 Body (二进制内容) ---');
      console.log('内容类型:', contentType);
      console.log('直接返回二进制内容');
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders
      });

    } catch (error) {
      // 错误处理
      console.error('\n!!! 代理请求失败 !!!');
      console.error('错误消息:', error.message);
      return new Response(`代理请求失败: ${error.message}`, {
        status: 500,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8'
        }
      });
    }
  }
};

/**
 * 将 ArrayBuffer 转换为十六进制字符串
 */
function arrayBufferToHex(buffer) {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * 重写内容中的绝对 URL
 */
function rewriteUrlsInContent(content, proxyUrl, targetUrl) {
  try {
    const proxyOrigin = new URL(proxyUrl).origin;
    const escapedTargetUrl = TARGET_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedTargetHost = TARGET_HOST.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    let rewritten = content;

    // 重写绝对 URL
    rewritten = rewritten.replace(
      new RegExp(escapedTargetUrl, 'g'),
      proxyOrigin
    );

    // 处理协议相对 URL
    rewritten = rewritten.replace(
      new RegExp(`//${escapedTargetHost}(?![\\w])`, 'g'),
      `//${new URL(proxyUrl).hostname}`
    );

    return rewritten;
  } catch (error) {
    console.error('URL 重写失败:', error);
    return content;
  }
}
