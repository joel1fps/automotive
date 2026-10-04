import { chromium } from 'playwright';
const browser = await chromium.launch({headless:true});
try {
 const page = await browser.newPage({viewport:{width:390,height:844}, reducedMotion:'reduce'});
 await page.goto('http://localhost:3035/entrar',{waitUntil:'domcontentloaded'});
 await page.getByRole('link',{name:'Esqueceu a senha?'}).click();
 await page.waitForURL('**/recuperar-senha');
 await page.getByLabel('Seu e-mail').waitFor();
 await page.getByRole('button',{name:'Enviar código'}).click();
 const valid = await page.getByLabel('Seu e-mail').evaluate(el=>el.validity.valueMissing);
 if(!valid) throw Error('Required email validation absent');
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)) throw Error('Mobile overflow');
 await page.getByRole('link',{name:'Voltar para entrar'}).click();
 await page.waitForURL('**/entrar');
 console.log('PASS: login link, recovery route, required email, mobile width, return navigation. No email sent.');
} finally {await browser.close();}
