(() => {
  const launch = document.querySelector('.assistant-launch');
  const panel = document.querySelector('.assistant-panel');
  const form = document.querySelector('.assistant-form');
  const messages = document.querySelector('.assistant-messages');
  if (!launch || !panel || !form || !messages) return;
  launch.addEventListener('click', () => { panel.hidden = false; form.elements.message.focus(); });
  document.querySelector('.assistant-close')?.addEventListener('click', () => { panel.hidden = true; });
  function bubble(text, type='assistant') { const p=document.createElement('p'); p.className=`assistant-bubble ${type}`; p.textContent=text; messages.append(p); messages.scrollTop=messages.scrollHeight; return p; }
  function linkButton(label, href, parent) { const a=document.createElement('a'); a.className='button secondary assistant-link'; a.href=href; a.textContent=label; parent.append(a); }
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); const input=form.elements.message; const q=input.value.trim(); if (!q) return;
    bubble(q,'user'); input.value=''; const lower=q.toLowerCase();
    const nav=[[/\b(inventory|stock list)\b/, '/inventory','Open inventory'],[/\b(scanner|scan|barcode)\b/, '/scan','Open scanner'],[/\b(transaction|history|activity)\b/, '/transactions','Open transaction history'],[/\b(add|register) (a )?product\b/, '/products/new','Register product'],[/\b(user management|manage users|users)\b/, '/admin/users','Open user management']];
    if (/\b(low[ -]stock|out of stock)\b/.test(lower)) {
      try { const res=await fetch('/api/search?q='); const data=await res.json(); const products=(data.products||[]); const filtered=products.filter(p=>p.quantity===0||p.quantity<=p.minimum_quantity); bubble(filtered.length?`There are ${filtered.length} low or out of stock products: ${filtered.slice(0,6).map(p=>`${p.name} (${p.quantity})`).join(', ')}.`:'No products are currently low on stock.'); } catch { bubble('I could not load stock status right now.'); }
      return;
    }
    const actionMatch=lower.match(/\b(remove|take out|add|increase)\s+(\d+)\s+(.+)/);
    const countQuery=lower.match(/\bhow many\s+(.+?)(?:\s+do we have|\s+are there|[?!.]|$)/);
    const searchTerm=actionMatch ? actionMatch[3].replace(/[?.!]+$/,'').trim() : (countQuery?.[1] || q.match(/\b(find|quantity of|where is)\s+(.+)/i)?.[2] || '');
    if (searchTerm) {
      try {
        const data=await (await fetch(`/api/search?q=${encodeURIComponent(searchTerm)}`)).json(); const product=data.products?.[0];
        if (!product) { bubble(`I couldn't find a product matching “${searchTerm}”.`); return; }
        if (actionMatch) {
          const count=Number(actionMatch[2]); const action=/^(remove|take out)$/.test(actionMatch[1])?'REMOVE':'ADD'; const next=action==='ADD'?product.quantity+count:product.quantity-count;
          const msg=bubble(`I found ${product.name}. Current quantity: ${product.quantity}. You requested to ${action.toLowerCase()} ${count}. New quantity would be ${next < 0 ? 'below zero and cannot be saved' : next}. Review the change before confirming.`);
          linkButton('Review Change',`/products/${encodeURIComponent(product.barcode)}?action=${action}&amount=${count}`,msg); return;
        }
        bubble(`${product.name} · ${product.product_id}\nQuantity: ${product.quantity}\nCategory: ${product.category}\nLocation: ${product.location}`);
        const last=messages.lastElementChild; linkButton('Open product',`/products/${encodeURIComponent(product.barcode)}`,last); return;
      } catch { bubble('I could not search inventory right now.'); return; }
    }
    const match=nav.find(([pattern])=>pattern.test(lower));
    if(match) { bubble(`Opening ${match[2]}.`); window.location.href=match[1]; return; }
    if (/\b(help|how do i|how to)\b/.test(lower)) bubble('Scan an item to look it up, then choose Add or Remove and confirm the quantity change. Admins can add users from User Management.');
    else bubble('I can open inventory, the scanner, transaction history, or user management; search for a product; and show low stock.');
  });
})();
