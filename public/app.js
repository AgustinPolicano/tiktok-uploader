const form = document.querySelector('#composerForm');
const statusCard = document.querySelector('#statusCard');
const result = document.querySelector('#result');
const history = document.querySelector('#history');
const caption = document.querySelector('#caption');
const generateCaption = document.querySelector('#generateCaption');
const copyCaption = document.querySelector('#copyCaption');
const tiktokOAuth = document.querySelector('#tiktokOAuth');

loadStatus();
loadTikTokOAuth();
loadHistory();

generateCaption.addEventListener('click', async () => {
  const formData = new FormData(form);
  formData.set('platform', selectedPlatforms().join(', ') || 'both');
  setBusy(generateCaption, true, 'Generando...');

  try {
    const data = await postForm('/api/caption', formData);
    caption.value = data.caption;
    result.textContent = JSON.stringify(data, null, 2);
  } catch (error) {
    result.textContent = error.message;
  } finally {
    setBusy(generateCaption, false, 'Generar caption');
  }
});

copyCaption.addEventListener('click', async () => {
  await navigator.clipboard.writeText(caption.value);
  copyCaption.textContent = 'Copiada';
  setTimeout(() => {
    copyCaption.textContent = 'Copiar caption';
  }, 1200);
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const formData = new FormData(form);
  setBusy(form.querySelector('.publish'), true, 'Procesando...');
  result.textContent = 'Trabajando...';

  try {
    const data = await postForm('/api/publish', formData);
    result.textContent = JSON.stringify(data, null, 2);
    await loadTikTokOAuth();
    await loadHistory();
  } catch (error) {
    result.textContent = error.message;
  } finally {
    setBusy(form.querySelector('.publish'), false, 'Publicar / enviar');
  }
});

async function loadStatus() {
  const response = await fetch('/api/status');
  const data = await response.json();

  statusCard.innerHTML = `
    <strong>Estado</strong>
    <span>${data.instagramReady ? 'OK' : 'Falta'} Instagram</span>
    <span>${data.tiktokReady ? 'OK' : 'Falta'} TikTok</span>
    <span>${data.aiReady ? 'OK' : 'Fallback'} IA</span>
    <span>${data.mediaPublicBaseUrl ? 'OK URL publica' : data.githubReady ? 'OK GitHub gratis' : data.cloudinaryReady ? 'OK Cloudinary' : 'Falta media publico'}</span>
  `;
}

async function loadTikTokOAuth() {
  const response = await fetch('/api/tiktok/status');
  const data = await response.json();

  tiktokOAuth.innerHTML = `
    <p>${data.connected ? 'Conectado' : 'No conectado'}${data.usingEnvToken ? ' con token manual' : ''}</p>
    <small>${data.scope ? `Scopes: ${data.scope}` : data.configured ? 'OAuth configurado' : 'Falta configurar TikTok OAuth'}</small>
    <div class="oauth-actions">
      <a class="oauth-button" href="/api/tiktok/auth">Conectar TikTok</a>
      <button type="button" id="disconnectTikTok">Desconectar</button>
    </div>
  `;

  tiktokOAuth.querySelector('#disconnectTikTok').addEventListener('click', async () => {
    await fetch('/api/tiktok/disconnect', { method: 'POST' });
    await loadTikTokOAuth();
  });
}

async function loadHistory() {
  const response = await fetch('/api/history');
  const items = await response.json();

  history.innerHTML = items.length
    ? items
        .map(
          (item) => `
            <article class="history-item">
              <strong>${item.originalName}</strong>
              <span>${new Date(item.createdAt).toLocaleString()}</span>
              <small>${item.platforms.join(' + ')}</small>
            </article>
          `,
        )
        .join('')
    : '<p class="muted">Sin historial.</p>';
}

async function postForm(url, formData) {
  const response = await fetch(url, {
    method: 'POST',
    body: formData,
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Fallo el request.');
  }

  return data;
}

function selectedPlatforms() {
  return [...form.querySelectorAll('input[name="platforms"]:checked')].map((input) => input.value);
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  button.textContent = label;
}
