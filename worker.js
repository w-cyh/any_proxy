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
      headers.forEach((value, key) => {
        console.log(`${key}: ${value}`);
      });

      // 构建目标 URL，保持原始路径和查询参数
      const targetUrl = `${TARGET_URL}${url.pathname}${url.search}`;
      console.log('\n--- 目标信息 ---');
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
      responseHeaders.set('Access-Control-Allow-Origin',
