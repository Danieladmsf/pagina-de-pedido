fetch('https://polarispdv.vercel.app/gostinho-de-ceu-5n3mkc')
  .then(r => r.text())
  .then(t => {
    const m = t.match(/og:image" content="([^"]+)"/);
    console.log(m ? m[1] : 'Not found');
  })
  .catch(console.error);
