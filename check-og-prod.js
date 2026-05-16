fetch('https://polarispdv.vercel.app/gostinho-de-ceu-5n3mkc')
  .then(r => r.text())
  .then(t => {
    const m = t.match(/<meta property="og:image" content="([^"]+)"/);
    console.log('OG Image:', m ? m[1] : 'Not found');
  })
  .catch(console.error);
