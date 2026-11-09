// Runs before first paint so the saved theme applies without a flash.
try {
  var t = localStorage.getItem('halaqa-theme')
  if (t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches)) document.documentElement.classList.add('dark')
} catch (e) {}
