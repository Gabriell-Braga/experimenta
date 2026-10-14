// Comportamentos do site demo (sem relação com o snippet).
(function () {
  var form = document.getElementById('newsletter-form');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      form.querySelector('output').textContent = 'Obrigado!';
    });
  }
  // Elemento que aparece depois do carregamento (testa espera via MutationObserver).
  var slot = document.getElementById('late-slot');
  if (slot) {
    setTimeout(function () {
      var b = document.createElement('div');
      b.className = 'promo-banner';
      b.textContent = 'Promoção relâmpago: 20% OFF';
      slot.appendChild(b);
    }, 800);
  }
})();
