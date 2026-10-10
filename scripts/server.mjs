import http from 'node:http';
import {open, realpath, stat} from 'node:fs/promises';
import path from 'node:path';
import {publicRedirect} from '../src/routes.mjs';

const mime = {'.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2', '.pdf': 'application/pdf'};
const within = (root, file) => { const relative = path.relative(root, file); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); };

export function createStaticServer({root, beforeRequest, beforeFile}) {
  const absoluteRoot = path.resolve(root);
  return http.createServer(async (req, res) => {
    const reply = (status, message, headers = {}) => {
      res.writeHead(status, {'Content-Type': 'text/plain; charset=utf-8', ...headers});
      res.end(req.method === 'HEAD' ? undefined : message);
    };
    try {
      if (beforeRequest && await beforeRequest(req,res)) return;
      if (!['GET', 'HEAD'].includes(req.method)) return reply(405, 'Method Not Allowed', {Allow: 'GET, HEAD'});
      let pathname;
      try { pathname = decodeURIComponent((req.url ?? '').split('?')[0]); } catch { return reply(400, 'Bad Request'); }
      if (!pathname.startsWith('/') || /[\\\x00-\x1f:]/.test(pathname)) return reply(400, 'Bad Request');
      if (pathname.split('/').includes('..')) return reply(403, 'Forbidden');
      const candidate = path.resolve(absoluteRoot, `.${pathname}`);
      if (!within(absoluteRoot, candidate)) return reply(403, 'Forbidden');
      const redirect = publicRedirect(pathname);
      if (redirect) {
        const queryAt = req.url.indexOf('?');
        const query = queryAt === -1 ? '' : req.url.slice(queryAt);
        return reply(308, 'Permanent Redirect', {Location: redirect + query});
      }
      let file = candidate;
      let info = await stat(file);
      if (info.isDirectory()) { file = path.join(file, 'index.html'); info = await stat(file); }
      if (!info.isFile()) return reply(404, 'Not Found');
      const [realRoot, realFile] = await Promise.all([realpath(absoluteRoot), realpath(file)]);
      if (!within(realRoot, realFile)) return reply(403, 'Forbidden');
      // Authorize the resolved target too: symlinks and NTFS short names can alias a protected route.
      if (beforeFile && await beforeFile(req,res,{realRoot,realFile})) return;
      const headers = {'Content-Type': mime[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': res.getHeader('Cache-Control') || 'no-cache'};
      let start = 0, end = info.size - 1, status = 200;
      if (req.headers.range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        let valid = Boolean(match && (match[1] || match[2]) && info.size);
        if (valid) {
          if (!match[1]) { const suffix = Number(match[2]); valid = Number.isSafeInteger(suffix) && suffix > 0; start = Math.max(0, info.size - suffix); }
          else { start = Number(match[1]); end = match[2] ? Number(match[2]) : end; valid = Number.isSafeInteger(start) && Number.isSafeInteger(end) && start <= end && start < info.size; end = Math.min(end, info.size - 1); }
        }
        if (!valid) return reply(416, 'Range Not Satisfiable', {'Content-Range': `bytes */${info.size}`});
        status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
      }
      headers['Content-Length'] = status === 206 ? end - start + 1 : info.size;
      if (req.method === 'HEAD' || info.size === 0) { res.writeHead(status, headers); return res.end(); }
      // Open before committing headers so a file removed during a rebuild yields a real 404.
      const handle = await open(realFile, 'r');
      const stream = handle.createReadStream({start, end});
      stream.on('error', () => res.destroy());
      res.on('close', () => stream.destroy());
      res.writeHead(status, headers); stream.pipe(res);
    } catch (error) {
      if (res.headersSent) return res.destroy();
      reply(['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error.code) ? 404 : 500, error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 'Not Found' : 'Unable to serve file');
    }
  });
}
