import { chromium } from "playwright";
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage();
 page.on("pageerror",e=>console.error("PAGE ERROR:",e.message));
 await page.goto("http://127.0.0.1:4173/tests/storage-v9.test.html");
 await page.locator("#run").click();
 await page.waitForFunction(()=>document.querySelector("#summary").textContent.includes("من 10 اختبار"),{timeout:30000});
 const summary=await page.locator("#summary").textContent();
 console.log(summary);
 if(!summary.startsWith("النتيجة: 10 ناجح / 0 فاشل")) process.exitCode=1;
}finally{await browser.close();}
