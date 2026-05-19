import 'dotenv/config';

import express from 'express';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import multer from 'multer';

const app = express();
const port = Number(process.env.PORT || 4317);
const rootDir = process.cwd();
const uploadsDir = path.join(rootDir, 'uploads');
const historyPath = path.join(rootDir, 'data', 'history.json');
const contextPath = path.join(rootDir, 'data', 'context.md');
const tiktokTokenPath = path.join(rootDir, 'data', 'tiktok-token.json');
const dashboardToken = process.env.DASHBOARD_TOKEN || '';
const uploadRetentionHours = Number(process.env.UPLOAD_RETENTION_HOURS || 24);

const upload = multer({
  dest: uploadsDir,
  limits: {
    fileSize: 500 * 1024 * 1024,
  },
});

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(uploadsDir));
app.get('/login', renderLogin);
app.post('/api/login', handleLogin);
app.post('/api/logout', (_request, response) => {
  response.setHeader('Set-Cookie', 'dashboard_token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  response.redirect('/login');
});
app.use(requireDashboardToken);
app.use(express.static(path.join(rootDir, 'public')));

app.get('/api/status', (_request, response) => {
  response.json({
    instagramReady: Boolean(process.env.INSTAGRAM_ACCESS_TOKEN && process.env.INSTAGRAM_USER_ID),
    tiktokReady: Boolean(process.env.TIKTOK_ACCESS_TOKEN || process.env.TIKTOK_CLIENT_KEY),
    tiktokOAuthReady: hasTikTokOAuthConfig(),
    aiReady: Boolean(process.env.AI_API_KEY),
    cloudinaryReady: hasCloudinaryConfig(),
    githubReady: hasGithubStorageConfig(),
    mediaPublicBaseUrl: process.env.MEDIA_PUBLIC_BASE_URL || null,
  });
});

app.get('/api/tiktok/status', async (_request, response) => {
  const token = await readTikTokToken();

  response.json({
    configured: hasTikTokOAuthConfig(),
    connected: Boolean(token?.access_token || process.env.TIKTOK_ACCESS_TOKEN),
    openId: token?.open_id || null,
    scope: token?.scope || null,
    accessTokenExpiresAt: token?.access_token_expires_at || null,
    refreshTokenExpiresAt: token?.refresh_token_expires_at || null,
    usingEnvToken: Boolean(!token?.access_token && process.env.TIKTOK_ACCESS_TOKEN),
  });
});

app.get('/api/tiktok/auth', (_request, response) => {
  try {
    const clientKey = requiredEnv('TIKTOK_CLIENT_KEY');
    const redirectUri = requiredEnv('TIKTOK_REDIRECT_URI');
    const state = randomUUID();
    const authUrl = new URL('https://www.tiktok.com/v2/auth/authorize/');

    authUrl.searchParams.set('client_key', clientKey);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', process.env.TIKTOK_SCOPES || 'video.upload');
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('state', state);

    response.setHeader('Set-Cookie', `tiktok_oauth_state=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`);
    response.redirect(authUrl.toString());
  } catch (error) {
    response.status(error.status || 500).json(toErrorResponse(error));
  }
});

app.get('/auth/tiktok/callback', async (request, response) => {
  try {
    const expectedState = parseCookie(request.headers.cookie).tiktok_oauth_state;
    const receivedState = String(request.query.state || '');
    const code = String(request.query.code || '');

    if (!expectedState || expectedState !== receivedState) {
      throw new HttpError(400, 'State invalido en OAuth TikTok. Reintenta la conexion.');
    }

    if (!code) {
      throw new HttpError(400, `TikTok no devolvio code: ${request.query.error || 'sin detalle'}`);
    }

    const token = await exchangeTikTokCode(code);
    await writeTikTokToken(token);

    response.setHeader('Set-Cookie', 'tiktok_oauth_state=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    response.type('html').send(`<!doctype html><html lang="es"><body style="font-family: system-ui; padding: 2rem;"><h1>TikTok conectado</h1><p>Ya podes volver al dashboard.</p><p><a href="/">Volver</a></p></body></html>`);
  } catch (error) {
    response.status(error.status || 500).type('html').send(`<pre>${escapeHtml(error.message || 'Error OAuth TikTok')}</pre><p><a href="/">Volver</a></p>`);
  }
});

app.post('/api/tiktok/disconnect', async (_request, response) => {
  await fs.rm(tiktokTokenPath, { force: true });
  response.json({ ok: true });
});

app.get('/api/history', async (_request, response) => {
  response.json(await readHistory());
});

app.post('/api/caption', upload.single('media'), async (request, response) => {
  try {
    const caption = await generateCaption({
      idea: String(request.body.idea || ''),
      platform: String(request.body.platform || 'both'),
      extraContext: String(request.body.extraContext || ''),
      mediaName: request.file?.originalname || '',
    });

    response.json({ caption });
  } catch (error) {
    response.status(500).json(toErrorResponse(error));
  } finally {
    if (request.file) {
      await fs.rm(request.file.path, { force: true });
    }
  }
});

app.post('/api/publish', upload.single('media'), async (request, response) => {
  try {
    if (!request.file) {
      throw new HttpError(400, 'Subi una imagen o video primero.');
    }

    const platforms = parsePlatforms(request.body.platforms);
    const caption = String(request.body.caption || '').trim();
    const media = await persistUploadedFile(request.file);
    const publicMedia = platforms.includes('instagram') ? await resolvePublicMedia(media) : getLocalPublicMedia(media.filename);
    const results = {};

    if (platforms.includes('instagram')) {
      results.instagram = await publishInstagram({ media, mediaUrl: publicMedia.url, caption });
    }

    if (platforms.includes('tiktok')) {
      results.tiktok = await uploadTikTokInbox({ media });
    }

    const item = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      originalName: request.file.originalname,
      filename: media.filename,
      mediaUrl: publicMedia.url,
      mediaSource: publicMedia.source,
      caption,
      platforms,
      results,
    };

    await appendHistory(item);
    response.json(item);
  } catch (error) {
    if (request.file) {
      await fs.rm(request.file.path, { force: true });
    }

    response.status(error.status || 500).json(toErrorResponse(error));
  }
});

app.listen(port, () => {
  console.log(`Social Publisher Dashboard running at http://localhost:${port}`);
});

await cleanupUploads();
setInterval(cleanupUploads, 60 * 60 * 1000).unref();

function renderLogin(_request, response) {
  if (!dashboardToken) {
    response.redirect('/');
    return;
  }

  response.type('html').send(`<!doctype html>
    <html lang="es">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Login - Social Publisher</title>
        <style>
          body { background: #080a0f; color: #f7f1e8; display: grid; font-family: system-ui, sans-serif; min-height: 100vh; margin: 0; place-items: center; }
          form { background: #111722; border: 1px solid #2a3548; border-radius: 28px; display: grid; gap: 1rem; max-width: 28rem; padding: 2rem; width: calc(100% - 2rem); }
          input, button { border: 0; border-radius: 999px; font: inherit; padding: 1rem; }
          input { background: #080a0f; border: 1px solid #2a3548; color: #f7f1e8; }
          button { background: #ff6b35; color: #10131a; cursor: pointer; font-weight: 800; }
          p { color: #a6adb9; margin: 0; }
        </style>
      </head>
      <body>
        <form method="post" action="/api/login">
          <h1>Social Publisher</h1>
          <p>Token local. Sin esto, cualquiera podria publicar en tus redes.</p>
          <input name="token" type="password" placeholder="DASHBOARD_TOKEN" autofocus required />
          <button type="submit">Entrar</button>
        </form>
      </body>
    </html>`);
}

function handleLogin(request, response) {
  if (!dashboardToken) {
    response.redirect('/');
    return;
  }

  if (request.body.token !== dashboardToken) {
    response.status(401).send('Token invalido. Ponete las pilas.');
    return;
  }

  response.setHeader('Set-Cookie', `dashboard_token=${encodeURIComponent(dashboardToken)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`);
  response.redirect('/');
}

function requireDashboardToken(request, response, next) {
  if (!dashboardToken) {
    next();
    return;
  }

  const token = request.get('x-dashboard-token') || parseCookie(request.headers.cookie).dashboard_token;

  if (token === dashboardToken) {
    next();
    return;
  }

  if (request.path.startsWith('/api/')) {
    response.status(401).json({ error: 'No autorizado. Falta DASHBOARD_TOKEN.' });
    return;
  }

  response.redirect('/login');
}

async function generateCaption({ idea, platform, extraContext, mediaName }) {
  const productContext = await readTextIfExists(contextPath);

  if (!process.env.AI_API_KEY) {
    const cleanIdea = idea || 'Nuevo contenido';
    return `${cleanIdea}\n\n${extraContext ? `${extraContext}\n\n` : ''}#ugc #contenido #marca`;
  }

  const endpoint = `${process.env.AI_BASE_URL || 'https://api.openai.com/v1'}/chat/completions`;
  const aiResponse = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.AI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.AI_MODEL || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'Sos un estratega de social media. Genera captions concretas, naturales y listas para publicar. No inventes claims medicos, financieros ni resultados no probados.',
        },
        {
          role: 'user',
          content: [
            `Contexto de marca:\n${productContext}`,
            `Plataforma objetivo: ${platform}`,
            `Nombre del archivo: ${mediaName}`,
            `Idea del post: ${idea}`,
            `Contexto extra: ${extraContext}`,
            'Devolve solo la caption final con hashtags. Maximo 1200 caracteres.',
          ].join('\n\n'),
        },
      ],
      temperature: 0.8,
    }),
  });

  const data = await aiResponse.json();

  if (!aiResponse.ok) {
    throw new HttpError(aiResponse.status, data.error?.message || 'Fallo la generacion de caption con IA.');
  }

  return data.choices?.[0]?.message?.content?.trim() || '';
}

async function publishInstagram({ media, mediaUrl, caption }) {
  const accessToken = requiredEnv('INSTAGRAM_ACCESS_TOKEN');
  const instagramUserId = requiredEnv('INSTAGRAM_USER_ID');
  const createUrl = new URL(`https://graph.facebook.com/v21.0/${instagramUserId}/media`);

  createUrl.searchParams.set('access_token', accessToken);
  createUrl.searchParams.set('caption', caption);

  if (media.kind === 'image') {
    createUrl.searchParams.set('image_url', mediaUrl);
  } else {
    createUrl.searchParams.set('media_type', 'REELS');
    createUrl.searchParams.set('video_url', mediaUrl);
  }

  const creation = await graphPost(createUrl);

  if (media.kind === 'video') {
    await waitForInstagramContainer({ containerId: creation.id, accessToken });
  }

  const publishUrl = new URL(`https://graph.facebook.com/v21.0/${instagramUserId}/media_publish`);
  publishUrl.searchParams.set('access_token', accessToken);
  publishUrl.searchParams.set('creation_id', creation.id);

  return graphPost(publishUrl);
}

async function uploadTikTokInbox({ media }) {
  if (media.kind !== 'video') {
    throw new HttpError(400, 'TikTok inbox del MVP soporta video. Para imagenes hay que agregar el flujo photo upload despues.');
  }

  const accessToken = await getTikTokAccessToken();
  const videoSize = media.size;
  const initResponse = await fetch('https://open.tiktokapis.com/v2/post/publish/inbox/video/init/', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: videoSize,
        chunk_size: videoSize,
        total_chunk_count: 1,
      },
    }),
  });

  const initData = await initResponse.json();

  if (!initResponse.ok || initData.error?.code !== 'ok') {
    throw new HttpError(initResponse.status, initData.error?.message || 'TikTok rechazo el inicio del upload inbox.');
  }

  const uploadResponse = await fetch(initData.data.upload_url, {
    method: 'PUT',
    headers: {
      'Content-Type': media.mimeType,
      'Content-Range': `bytes 0-${videoSize - 1}/${videoSize}`,
    },
    body: createReadStream(media.path),
    duplex: 'half',
  });

  if (!uploadResponse.ok) {
    throw new HttpError(uploadResponse.status, 'Fallo la subida del video a TikTok.');
  }

  return {
    publish_id: initData.data.publish_id,
    note: 'TikTok no acepta caption en este flujo inbox upload; copiala desde el dashboard cuando abras la notificacion.',
  };
}

async function exchangeTikTokCode(code) {
  const body = new URLSearchParams({
    client_key: requiredEnv('TIKTOK_CLIENT_KEY'),
    client_secret: requiredEnv('TIKTOK_CLIENT_SECRET'),
    code,
    grant_type: 'authorization_code',
    redirect_uri: requiredEnv('TIKTOK_REDIRECT_URI'),
  });

  const response = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cache-Control': 'no-cache',
    },
    body,
  });
  const data = await response.json();

  if (!response.ok || data.error) {
    throw new HttpError(response.status, data.error_description || data.message || data.error || 'TikTok rechazo el intercambio de code.');
  }

  return normalizeTikTokToken(data);
}

async function refreshTikTokToken(refreshToken) {
  const body = new URLSearchParams({
    client_key: requiredEnv('TIKTOK_CLIENT_KEY'),
    client_secret: requiredEnv('TIKTOK_CLIENT_SECRET'),
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const response = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cache-Control': 'no-cache',
    },
    body,
  });
  const data = await response.json();

  if (!response.ok || data.error) {
    throw new HttpError(response.status, data.error_description || data.message || data.error || 'TikTok rechazo el refresh token.');
  }

  return normalizeTikTokToken(data);
}

async function getTikTokAccessToken() {
  const token = await readTikTokToken();

  if (!token?.access_token) {
    if (hasTikTokOAuthConfig() && !process.env.TIKTOK_ACCESS_TOKEN) {
      throw new HttpError(400, 'TikTok no esta conectado. Usa el boton Conectar TikTok en el dashboard.');
    }

    return requiredEnv('TIKTOK_ACCESS_TOKEN');
  }

  const expiresAt = new Date(token.access_token_expires_at).getTime();
  const refreshSafetyWindowMs = 5 * 60 * 1000;

  if (Number.isFinite(expiresAt) && Date.now() < expiresAt - refreshSafetyWindowMs) {
    return token.access_token;
  }

  if (!token.refresh_token) {
    return requiredEnv('TIKTOK_ACCESS_TOKEN');
  }

  const refreshedToken = await refreshTikTokToken(token.refresh_token);
  await writeTikTokToken(refreshedToken);

  return refreshedToken.access_token;
}

function normalizeTikTokToken(data) {
  const now = Date.now();
  const expiresIn = Number(data.expires_in || 0);
  const refreshExpiresIn = Number(data.refresh_expires_in || 0);

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    open_id: data.open_id,
    scope: data.scope,
    token_type: data.token_type,
    expires_in: expiresIn,
    refresh_expires_in: refreshExpiresIn,
    access_token_expires_at: new Date(now + expiresIn * 1000).toISOString(),
    refresh_token_expires_at: new Date(now + refreshExpiresIn * 1000).toISOString(),
    updated_at: new Date(now).toISOString(),
  };
}

async function readTikTokToken() {
  const raw = await readTextIfExists(tiktokTokenPath);
  return raw ? JSON.parse(raw) : null;
}

async function writeTikTokToken(token) {
  await fs.writeFile(tiktokTokenPath, JSON.stringify(token, null, 2));
}

function hasTikTokOAuthConfig() {
  return Boolean(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET && process.env.TIKTOK_REDIRECT_URI);
}

async function graphPost(url) {
  const graphResponse = await fetch(url, { method: 'POST' });
  const data = await graphResponse.json();

  if (!graphResponse.ok || data.error) {
    throw new HttpError(graphResponse.status, data.error?.message || 'Fallo Instagram Graph API.');
  }

  return data;
}

async function waitForInstagramContainer({ containerId, accessToken }) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const statusUrl = new URL(`https://graph.facebook.com/v21.0/${containerId}`);
    statusUrl.searchParams.set('fields', 'status_code');
    statusUrl.searchParams.set('access_token', accessToken);

    const response = await fetch(statusUrl);
    const data = await response.json();

    if (data.status_code === 'FINISHED') {
      return;
    }

    if (data.status_code === 'ERROR') {
      throw new HttpError(400, 'Instagram no pudo procesar el video.');
    }

    await sleep(5000);
  }

  throw new HttpError(408, 'Instagram tardo demasiado procesando el video. Proba publicar de nuevo en unos minutos.');
}

async function persistUploadedFile(file) {
  const extension = path.extname(file.originalname).toLowerCase();
  const safeExtension = extension || mimeToExtension(file.mimetype);
  const filename = `${Date.now()}-${randomUUID()}${safeExtension}`;
  const finalPath = path.join(uploadsDir, filename);

  await fs.rename(file.path, finalPath);

  return {
    filename,
    path: finalPath,
    size: file.size,
    mimeType: file.mimetype,
    kind: file.mimetype.startsWith('image/') ? 'image' : 'video',
  };
}

function getPublicMediaUrl(filename) {
  const baseUrl = process.env.MEDIA_PUBLIC_BASE_URL;

  if (!baseUrl) {
    return null;
  }

  return `${baseUrl.replace(/\/$/, '')}/uploads/${filename}`;
}

function getLocalPublicMedia(filename) {
  return {
    source: 'local',
    url: getPublicMediaUrl(filename),
  };
}

async function resolvePublicMedia(media) {
  const localUrl = getPublicMediaUrl(media.filename);

  if (localUrl) {
    return {
      source: 'public-base-url',
      url: localUrl,
    };
  }

  if (hasCloudinaryConfig()) {
    const uploaded = await uploadToCloudinary(media);
    return {
      source: 'cloudinary',
      url: uploaded.secure_url,
      publicId: uploaded.public_id,
    };
  }

  if (hasGithubStorageConfig()) {
    const uploaded = await uploadToGithubStorage(media);
    return {
      source: 'github',
      url: uploaded.url,
      path: uploaded.path,
      sha: uploaded.sha,
    };
  }

  throw new HttpError(
    400,
    'Instagram necesita una URL publica. Configura MEDIA_PUBLIC_BASE_URL, GitHub storage o Cloudinary.',
  );
}

async function uploadToGithubStorage(media) {
  const maxGithubUploadSize = 95 * 1024 * 1024;

  if (media.size > maxGithubUploadSize) {
    throw new HttpError(400, 'GitHub storage no sirve para archivos mayores a 95MB. Para videos grandes usa VPS, R2/S3 o un storage especializado.');
  }

  const token = requiredEnv('GITHUB_STORAGE_TOKEN');
  const owner = requiredEnv('GITHUB_STORAGE_OWNER');
  const repo = requiredEnv('GITHUB_STORAGE_REPO');
  const branch = process.env.GITHUB_STORAGE_BRANCH || 'main';
  const folder = (process.env.GITHUB_STORAGE_FOLDER || 'social-publisher-dashboard').replace(/^\/+|\/+$/g, '');
  const filePath = `${folder}/${media.filename}`;
  const fileBuffer = await fs.readFile(media.path);
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponentPath(filePath)}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      message: `upload social media asset ${media.filename}`,
      content: fileBuffer.toString('base64'),
      branch,
    }),
  });
  const data = await response.json();

  if (!response.ok) {
    throw new HttpError(response.status, data.message || 'GitHub rechazo el upload del media.');
  }

  return {
    path: filePath,
    sha: data.content?.sha,
    url: getGithubPublicUrl({ owner, repo, branch, filePath }),
  };
}

async function uploadToCloudinary(media) {
  const cloudName = requiredEnv('CLOUDINARY_CLOUD_NAME');
  const apiKey = requiredEnv('CLOUDINARY_API_KEY');
  const apiSecret = requiredEnv('CLOUDINARY_API_SECRET');
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = process.env.CLOUDINARY_FOLDER || 'social-publisher-dashboard';
  const resourceType = media.kind === 'image' ? 'image' : 'video';
  const signature = signCloudinaryParams({ folder, timestamp }, apiSecret);
  const formData = new FormData();
  const fileBuffer = await fs.readFile(media.path);

  formData.set('file', new Blob([fileBuffer], { type: media.mimeType }), media.filename);
  formData.set('api_key', apiKey);
  formData.set('timestamp', String(timestamp));
  formData.set('folder', folder);
  formData.set('signature', signature);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`, {
    method: 'POST',
    body: formData,
  });
  const data = await response.json();

  if (!response.ok) {
    throw new HttpError(response.status, data.error?.message || 'Cloudinary rechazo el upload del media.');
  }

  return data;
}

function hasCloudinaryConfig() {
  return Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
}

function hasGithubStorageConfig() {
  return Boolean(process.env.GITHUB_STORAGE_TOKEN && process.env.GITHUB_STORAGE_OWNER && process.env.GITHUB_STORAGE_REPO);
}

function getGithubPublicUrl({ owner, repo, branch, filePath }) {
  const publicBaseUrl = process.env.GITHUB_STORAGE_PUBLIC_BASE_URL;

  if (publicBaseUrl) {
    return `${publicBaseUrl.replace(/\/$/, '')}/${filePath}`;
  }

  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
}

function encodeURIComponentPath(filePath) {
  return filePath.split('/').map(encodeURIComponent).join('/');
}

function signCloudinaryParams(params, apiSecret) {
  const payload = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');

  return createHash('sha1').update(`${payload}${apiSecret}`).digest('hex');
}

function parsePlatforms(value) {
  const platforms = Array.isArray(value) ? value : [value].filter(Boolean);
  const valid = platforms.filter((platform) => ['instagram', 'tiktok'].includes(platform));

  if (valid.length === 0) {
    throw new HttpError(400, 'Elegi Instagram, TikTok o ambos.');
  }

  return valid;
}

async function readHistory() {
  const raw = await readTextIfExists(historyPath);
  return raw ? JSON.parse(raw) : [];
}

async function appendHistory(item) {
  const history = await readHistory();
  history.unshift(item);
  await fs.writeFile(historyPath, JSON.stringify(history.slice(0, 100), null, 2));
}

async function cleanupUploads() {
  if (!Number.isFinite(uploadRetentionHours) || uploadRetentionHours <= 0) {
    return;
  }

  const maxAgeMs = uploadRetentionHours * 60 * 60 * 1000;
  const now = Date.now();
  const entries = await fs.readdir(uploadsDir, { withFileTypes: true });

  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name !== '.gitkeep')
      .map(async (entry) => {
        const filePath = path.join(uploadsDir, entry.name);
        const stats = await fs.stat(filePath);

        if (now - stats.mtimeMs > maxAgeMs) {
          await fs.rm(filePath, { force: true });
        }
      }),
  );
}

async function readTextIfExists(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return '';
    }

    throw error;
  }
}

function requiredEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new HttpError(400, `Falta configurar ${name} en .env.`);
  }

  return value;
}

function mimeToExtension(mimeType) {
  if (mimeType === 'image/jpeg') return '.jpg';
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'video/mp4') return '.mp4';
  return '';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseCookie(header = '') {
  const cookies = {};

  for (const part of header.split(';')) {
    const [key, ...valueParts] = part.trim().split('=');

    if (key && valueParts.length > 0) {
      cookies[key] = decodeURIComponent(valueParts.join('='));
    }
  }

  return cookies;
}

function toErrorResponse(error) {
  return {
    error: error.message || 'Error inesperado.',
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
