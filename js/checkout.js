// The page Stripe Checkout returns to after a printed book's payment (checkout/?r=paid) or when the member goes back
// without paying (checkout/?r=cancelled). Only the outcome Stripe reports is shown; the order itself is read by the
// DayCasion app, which updates by itself.
(function () {
  const r = new URLSearchParams(location.search).get('r');
  const set = (id, text) => { const e = document.getElementById(id); if (e) e.textContent = text; };
  if (r === 'paid') {
    document.title = 'Payment received · DayCasion';
    set('ret-h', 'Thank you! Your payment was received.');
    set('ret-p', 'Your book is now being prepared for printing.');
    set('ret-next', 'You can follow its progress in My Keepsakes in the DayCasion app. It may take a moment to update.');
  } else if (r === 'cancelled') {
    document.title = 'No payment made · DayCasion';
    set('ret-h', 'No payment was made');
    set('ret-p', 'Your approved book is saved. You can pay for it in My Keepsakes in the DayCasion app while its price is guaranteed.');
  }
  // phones and tablets: the app can be opened from here too
  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) document.getElementById('ret-app').hidden = false;
})();
