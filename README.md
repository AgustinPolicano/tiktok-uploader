# Social Publisher Dashboard

Mini dashboard local para generar captions con IA, publicar en Instagram Business y mandar videos al inbox de TikTok.

Tambien puede correr en VPS con Docker Compose + Caddy para HTTPS automatico.

## GitHub Pages para TikTok

La carpeta `docs/` tiene un sitio estatico listo para GitHub Pages:

- Official website / Web URL / Desktop URL: `https://TU_USUARIO.github.io/TU_REPO/`
- Terms of Service URL: `https://TU_USUARIO.github.io/TU_REPO/terms.html`
- Privacy Policy URL: `https://TU_USUARIO.github.io/TU_REPO/privacy.html`
- TikTok Redirect URI: `https://TU_USUARIO.github.io/TU_REPO/oauth/tiktok/callback.html`

Activacion: GitHub repo -> `Settings` -> `Pages` -> `Deploy from a branch` -> branch `main` -> folder `/docs`.

El callback de GitHub Pages es un puente estatico: recibe el `code` de TikTok por HTTPS y lo redirige a `http://localhost:4317/auth/tiktok/callback`. Para usarlo, poné esa URL HTTPS en `TIKTOK_REDIRECT_URI`.

## Setup

1. Instala dependencias:

```bash
npm install
```

2. Crea `.env` desde `.env.example` y completa tokens:

```bash
cp .env.example .env
```

3. Edita `data/context.md` con contexto real de tu app/marca.

4. Levanta el server:

```bash
npm run dev
```

5. Abri `http://localhost:4317`.

## Variables importantes

- `APP_DOMAIN`: dominio publico del VPS, por ejemplo `social.tudominio.com`. No hace falta en modo local.
- `DASHBOARD_TOKEN`: clave larga para entrar al dashboard. En VPS es obligatoria si no queres regalar tu cuenta.
- `UPLOAD_RETENTION_HOURS`: horas antes de borrar uploads viejos. Default: `24`.
- `INSTAGRAM_ACCESS_TOKEN`: token de Meta con permisos para publicar.
- `INSTAGRAM_USER_ID`: Instagram Business Account ID, no el username.
- `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI`: OAuth de TikTok para obtener y refrescar tokens automaticamente.
- `MEDIA_PUBLIC_BASE_URL`: URL publica apuntando a este server o a los archivos subidos.
- `GITHUB_STORAGE_TOKEN`, `GITHUB_STORAGE_OWNER`, `GITHUB_STORAGE_REPO`: alternativa gratis para subir media por API y seguir 100% local.
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`: alternativa paga/freemium para subir media por API.
- `AI_API_KEY`: opcional. Si falta, usa una caption fallback basica.

## Modo 100% local gratis

Este modo evita VPS, evita tunnels y evita Cloudinary. El dashboard corre en tu maquina, pero cuando publicas en Instagram sube el archivo a un repo publico de GitHub por API para obtener una URL publica que Meta pueda leer.

No metas secretos en ese repo. Es solo para media publica.

Configura `.env` asi:

```env
PORT=4317
DASHBOARD_TOKEN=una-clave-larga
MEDIA_PUBLIC_BASE_URL=

INSTAGRAM_ACCESS_TOKEN=...
INSTAGRAM_USER_ID=...
TIKTOK_CLIENT_KEY=...
TIKTOK_CLIENT_SECRET=...
TIKTOK_REDIRECT_URI=https://TU_USUARIO.github.io/TU_REPO/oauth/tiktok/callback.html
TIKTOK_SCOPES=video.upload

GITHUB_STORAGE_TOKEN=github_pat_...
GITHUB_STORAGE_OWNER=tu-usuario
GITHUB_STORAGE_REPO=tu-repo-publico-de-media
GITHUB_STORAGE_BRANCH=main
GITHUB_STORAGE_FOLDER=social-publisher-dashboard
GITHUB_STORAGE_PUBLIC_BASE_URL=

AI_API_KEY=...
```

Flujo:

- Dashboard y API quedan locales en `http://localhost:4317`.
- TikTok usa `FILE_UPLOAD` directo desde tu maquina a TikTok.
- Instagram usa GitHub como storage publico del media.
- No expones tu dashboard a internet.
- No necesitas ngrok, Cloudflare Tunnel ni VPS.

Tradeoffs:

- El repo tiene que ser publico o Instagram no puede leer el archivo.
- GitHub no es un CDN de video. Para imagenes va bien; para videos grandes es una mala idea.
- El MVP bloquea uploads a GitHub mayores a `95MB`.
- Si queres borrar remoto automaticamente, hay que agregar una cola que espere a que Instagram termine de procesar y despues borre el archivo del repo. No lo hice por defecto porque borrar demasiado rapido puede romper el procesamiento de Meta.

## Modo 100% local con Cloudinary

Si despues queres usar Cloudinary, deja `MEDIA_PUBLIC_BASE_URL` vacio y configura:

```env
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
CLOUDINARY_FOLDER=social-publisher-dashboard
```

## Deploy en VPS

Requisitos:

- Un dominio o subdominio apuntando al IP del VPS.
- Docker y Docker Compose instalados.
- Puertos `80` y `443` abiertos.

Pasos:

```bash
cp .env.example .env
```

Edita `.env`:

```env
APP_DOMAIN=social.tudominio.com
MEDIA_PUBLIC_BASE_URL=https://social.tudominio.com
DASHBOARD_TOKEN=una-clave-larga-imposible-de-adivinar
INSTAGRAM_ACCESS_TOKEN=...
INSTAGRAM_USER_ID=...
TIKTOK_CLIENT_KEY=...
TIKTOK_CLIENT_SECRET=...
TIKTOK_REDIRECT_URI=https://social.tudominio.com/auth/tiktok/callback
TIKTOK_SCOPES=video.upload
AI_API_KEY=...
```

Levanta:

```bash
docker compose up -d
```

Ver logs:

```bash
docker compose logs -f
```

Actualizar luego de cambios:

```bash
docker compose up -d --build
```

Seguridad minima que ya queda aplicada:

- `/` y `/api/*` quedan protegidos por `DASHBOARD_TOKEN`.
- `/uploads/*` queda publico porque Instagram necesita descargar el archivo.
- Los nombres de archivo usan UUID.
- `UPLOAD_RETENTION_HOURS` borra uploads viejos automaticamente.

## Instagram

Instagram Graph API necesita leer el archivo desde una URL publica. Tenes tres caminos:

Opcion local gratis con GitHub:

```env
MEDIA_PUBLIC_BASE_URL=
GITHUB_STORAGE_TOKEN=...
GITHUB_STORAGE_OWNER=...
GITHUB_STORAGE_REPO=...
GITHUB_STORAGE_BRANCH=main
GITHUB_STORAGE_FOLDER=social-publisher-dashboard
```

Opcion local con Cloudinary:

```env
MEDIA_PUBLIC_BASE_URL=
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
```

Opcion VPS:

```env
MEDIA_PUBLIC_BASE_URL=https://social.tudominio.com
```

Si `MEDIA_PUBLIC_BASE_URL` existe, se usa esa URL. Si no existe y Cloudinary esta configurado, se sube a Cloudinary. Si no existe Cloudinary y GitHub esta configurado, se sube a GitHub.

Para GitHub, podes usar la URL raw default o un CDN publico. Si queres jsDelivr, configura:

```env
GITHUB_STORAGE_PUBLIC_BASE_URL=https://cdn.jsdelivr.net/gh/tu-usuario/tu-repo-publico-de-media@main
```

## TikTok

Este MVP usa Content Posting API inbox upload:

```txt
POST /v2/post/publish/inbox/video/init/
```

No publica directo. El usuario recibe una notificacion en TikTok inbox, revisa y publica manualmente.

### OAuth TikTok

Configura en `.env`:

```env
TIKTOK_CLIENT_KEY=...
TIKTOK_CLIENT_SECRET=...
TIKTOK_REDIRECT_URI=https://TU_USUARIO.github.io/TU_REPO/oauth/tiktok/callback.html
TIKTOK_SCOPES=video.upload
```

En TikTok Developer Portal, tu app debe tener:

- Login Kit configurado.
- Content Posting API agregado.
- Scope `video.upload` autorizado.
- Redirect URI registrado exactamente igual a `TIKTOK_REDIRECT_URI`.

Despues:

1. Levanta el dashboard con `npm run dev`.
2. Entra a `http://localhost:4317`.
3. En el panel `TikTok OAuth`, toca `Conectar TikTok`.
4. Autoriza la app.
5. La tool guarda el token en `data/tiktok-token.json` y lo refresca automaticamente.

TikTok pide redirect URI `https`. Para mantener el dashboard local, usa el callback puente de GitHub Pages: `https://TU_USUARIO.github.io/TU_REPO/oauth/tiktok/callback.html`. Esa pagina redirige el `code` al backend local en `http://localhost:4317/auth/tiktok/callback`.

Limitacion importante: en el flujo inbox upload de video, TikTok no acepta caption/title en el init request. La caption queda generada en el dashboard para copiarla cuando abras TikTok. Si queres caption prellenada, hay que evaluar otro flujo con mobile Share Kit o Direct Post, pero Direct Post publica directo y requiere `video.publish`.

## Checks

```bash
npm run check
```
