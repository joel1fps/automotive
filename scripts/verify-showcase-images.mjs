import {chromium} from 'playwright';
import {expect} from '@playwright/test';
const browser=await chromium.launch({headless:true});
try{
const page=await browser.newPage({reducedMotion:'reduce'});
await page.route('**/api/services',r=>r.fulfill({json:[{slug:'extra-7',name:'PPF',category:'extra',description:'',active:true,prices:null},{slug:'dedetizacao',name:'Dedetização',category:'extra',description:'',active:true,prices:null,imageUrl:'/missing-test-image.webp'},{slug:'extra-4',name:'Polimento',category:'extra',description:'',active:true,prices:null}]}));
await page.goto('http://127.0.0.1:3037/',{waitUntil:'domcontentloaded'});
await page.locator('#destaques').scrollIntoViewIfNeeded();
await expect(page.locator('#destaques img')).toHaveCount(3);
await page.locator('#destaques img').evaluateAll(imgs=>imgs.forEach(i=>i.loading='eager'));
await expect.poll(()=>page.locator('#destaques img').evaluateAll(imgs=>imgs.every(i=>i.complete&&i.naturalWidth>0))).toBe(true);
await expect(page.locator('#destaques img[alt="Dedetização"]')).toHaveAttribute('src','/brand/logo-white.webp');
console.log('PASS: default image, original artwork, and fallback for broken custom image load successfully.');
}finally{await browser.close();}
