const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', error => console.log('PAGE ERROR:', error.message));

  const url = 'file:///c:/Users/S%20Pavani/OneDrive/Desktop/salonstaffnew%20(3)/salonstaffnew/salon-staff-dashboard%20-%20Copy%20(2)/analytics.html';
  console.log('Navigating to', url);
  
  await page.goto(url, { waitUntil: 'networkidle2' });
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  await browser.close();
})();
