const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;

document.querySelector('.nav-toggle')?.addEventListener('click', (event) => {
  const nav = document.querySelector('.topbar nav');
  nav.classList.toggle('open');
  event.currentTarget.setAttribute('aria-expanded', nav.classList.contains('open'));
});

document.querySelector('.password-toggle')?.addEventListener('click', (event) => {
  const input = document.querySelector('#login-password');
  const visible = input.type === 'password'; input.type = visible ? 'text' : 'password';
  event.currentTarget.setAttribute('aria-pressed', String(visible));
  event.currentTarget.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
});

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken, ...(options.headers || {})}
  });
  const body = await response.json().catch(() => ({error: 'Unexpected server response.'}));
  if (!response.ok) throw new Error(body.error || 'Request failed.');
  return body;
}

const barcodeForm = document.querySelector('#barcode-form');
const barcodeInput = document.querySelector('#barcode-input');
const scanMessage = document.querySelector('#scan-message');
const productResult = document.querySelector('#product-result');

async function lookupBarcode(rawBarcode) {
  const barcode = rawBarcode.trim();
  if (!barcode) return;
  scanMessage.className = 'inline-message';
  scanMessage.textContent = 'Searching…';
  productResult.innerHTML = '';
  try {
    const data = await jsonRequest(`/api/products/${encodeURIComponent(barcode)}`, {method: 'GET'});
    const p = data.product;
    scanMessage.textContent = '';
    const card = document.createElement('div');
    card.className = 'result-card';
    const title = document.createElement('h2'); title.textContent = p.name;
    const meta = document.createElement('p'); meta.className = 'result-meta'; meta.textContent = `${p.product_id} · ${p.category} · ${p.location}`;
    const quantity = document.createElement('p'); quantity.textContent = `Quantity: ${p.quantity}`;
    const link = document.createElement('a'); link.className = 'button primary'; link.href = `/products/${encodeURIComponent(p.barcode)}`; link.textContent = 'Manage stock';
    card.append(title, meta, quantity, link); productResult.append(card);
  } catch (error) {
    if (error.message === 'Request failed.') error.message = 'Product not found.';
    scanMessage.className = 'inline-message error';
    scanMessage.textContent = error.message;
    if (document.querySelector('.scan-panel')?.dataset.canRegister === 'true') {
      const link = document.createElement('a'); link.className = 'button primary'; link.href = `/products/new?barcode=${encodeURIComponent(barcode)}`; link.textContent = 'Register New Product'; productResult.append(link);
    } else {
      const note=document.createElement('p'); note.textContent='Ask an administrator to register this product.'; productResult.append(note);
    }
  }
}

barcodeForm?.addEventListener('submit', (event) => { event.preventDefault(); lookupBarcode(barcodeInput.value); });

const quantityForm = document.querySelector('#quantity-form');
const confirmation = document.querySelector('#quantity-confirm');
let pendingQuantityChange = null;
quantityForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  const action = new FormData(quantityForm).get('action');
  const amount = Number(document.querySelector('#quantity-amount').value);
  const current = Number(document.querySelector('#quantity-value').textContent);
  if (!Number.isInteger(amount) || amount < 1 || (action === 'REMOVE' && amount > current)) return;
  pendingQuantityChange = {action, amount};
  document.querySelector('#quantity-confirm-copy').textContent = `${action === 'ADD' ? 'Add' : 'Remove'} ${amount} ${document.querySelector('.page-heading h1').textContent}? Current quantity: ${current}. New quantity: ${action === 'ADD' ? current + amount : current - amount}.`;
  confirmation?.showModal();
});
document.querySelector('#quantity-cancel')?.addEventListener('click', () => confirmation.close());
document.querySelector('#quantity-confirm-button')?.addEventListener('click', async () => {
  if (!pendingQuantityChange) return;
  const {action, amount} = pendingQuantityChange; confirmation.close(); pendingQuantityChange = null;
  const card = document.querySelector('.quantity-card'); const message = document.querySelector('#quantity-message');
  try {
    const data = await jsonRequest(`/api/products/${encodeURIComponent(card.dataset.barcode)}/quantity`, {method: 'POST', body: JSON.stringify({action, amount})});
    document.querySelector('#quantity-value').textContent = data.product.quantity;
    message.className = 'inline-message success'; message.textContent = data.message;
  } catch (error) { message.className = 'inline-message error'; message.textContent = error.message; }
});

const inventorySearch = document.querySelector('#inventory-search');
inventorySearch?.addEventListener('input', () => {
  filterInventory();
});
document.querySelector('#category-filter')?.addEventListener('change', filterInventory);
document.querySelector('#stock-filter')?.addEventListener('change', filterInventory);
function filterInventory() {
  const query = (inventorySearch?.value || '').toLowerCase();
  const category = document.querySelector('#category-filter')?.value.toLowerCase() || '';
  const stock = document.querySelector('#stock-filter')?.value || '';
  document.querySelectorAll('#inventory-table tbody tr').forEach(row => { row.hidden = !(row.textContent.toLowerCase().includes(query) && (!category || row.dataset.category === category) && (!stock || row.dataset.stock === stock)); });
}

const startCamera = document.querySelector('#start-camera');
const stopCamera = document.querySelector('#stop-camera');
const video = document.querySelector('#camera-preview');
const cameraStatus = document.querySelector('#camera-status');
let cameraStream = null, cameraTimer = null, detector = null, lastDetected = '';

function stopCameraScan() {
  clearInterval(cameraTimer); cameraTimer = null;
  cameraStream?.getTracks().forEach(track => track.stop()); cameraStream = null;
  if (video) video.srcObject = null;
  if (startCamera) startCamera.disabled = false;
  if (stopCamera) stopCamera.disabled = true;
}

startCamera?.addEventListener('click', async () => {
  if (!('BarcodeDetector' in window)) { cameraStatus.textContent = 'Camera barcode detection is not supported in this browser. Use Chrome/Edge on Android or a USB scanner.'; return; }
  try {
    detector = new BarcodeDetector({formats: ['ean_13','ean_8','code_128','code_39','upc_a','upc_e','qr_code']});
    cameraStream = await navigator.mediaDevices.getUserMedia({video: {facingMode: {ideal: 'environment'}}, audio: false});
    video.srcObject = cameraStream; await video.play();
    startCamera.disabled = true; stopCamera.disabled = false; cameraStatus.textContent = 'Point the camera at a barcode.';
    cameraTimer = setInterval(async () => {
      if (!detector || video.readyState < 2) return;
      try { const codes = await detector.detect(video); if (codes[0]?.rawValue && codes[0].rawValue !== lastDetected) { lastDetected = codes[0].rawValue; barcodeInput.value = lastDetected; stopCameraScan(); lookupBarcode(lastDetected); } } catch (_) {}
    }, 350);
  } catch (error) { cameraStatus.textContent = `Could not start camera: ${error.message}`; stopCameraScan(); }
});
stopCamera?.addEventListener('click', stopCameraScan);
window.addEventListener('pagehide', stopCameraScan);
