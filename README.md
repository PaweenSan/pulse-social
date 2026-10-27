# Pulse Social

Final Project เว็บไซต์ Social Media ด้วย **Vue.js 3 + Vite**, **Express.js**, **Drizzle ORM** และ **Turso (libSQL)** แยก frontend และ backend ชัดเจนใน repository เดียว

## ฟังก์ชัน

- สมัครสมาชิก เข้าสู่ระบบ และออกจากระบบ
- ดูและแก้ไขโปรไฟล์
- สร้าง แก้ไข และลบโพสต์ของตนเอง
- แนบไฟล์รูป JPG, PNG หรือ WebP จากเครื่องหรือมือถือได้หนึ่งรูปต่อโพสต์
- กด Like และแสดงความคิดเห็น
- หน้า Feed และหน้าโปรไฟล์ รองรับมือถือ

## โครงสร้าง

```text
pulse-social/
├── frontend/       # Vue 3, หน้าจอ และ Vite
├── backend/        # Express API และ Drizzle schema/migrations
├── package.json    # npm workspaces และคำสั่งส่วนกลาง
└── package-lock.json
```

## เริ่มพัฒนา

ใช้ Node.js 22.12 ขึ้นไป (Vercel ตั้งเป็น Node.js 24) จาก root folder:

```sh
npm ci
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
npm run db:migrate
```

เปิด terminal สองหน้าต่าง:

```sh
# Terminal 1 — API http://localhost:3001
npm run dev:backend
```

```sh
# Terminal 2 — เว็บไซต์ http://localhost:5173
npm run dev:frontend
```

Development ใช้ไฟล์ SQLite ผ่าน libSQL (`file:local.db`) จึงเริ่มใช้งานได้โดยไม่ต้องสมัครบริการก่อน ส่วน production ใช้ฐานข้อมูล Turso ระยะไกลเท่านั้น

บัญชีตัวอย่างจาก seed มีไว้แสดงเนื้อหา ไม่มีรหัสผ่านร่วม ให้สมัครบัญชีใหม่เพื่อทดสอบระบบ

```sh
npm run seed         # ข้อมูลตัวอย่าง สำหรับ development เท่านั้น
npm test             # ตรวจสอบ API และ utility ของ frontend
npm run build        # build frontend ไปยัง frontend/dist
```

เมื่อเปลี่ยน schema ให้รัน `npm run db:generate` แล้ว commit migration ที่สร้าง จากนั้นรัน `npm run db:migrate` กับฐานข้อมูลเป้าหมาย

หน้าโปรไฟล์แสดงโพสต์ล่าสุดไม่เกิน 50 รายการ และแต่ละโพสต์แสดงความคิดเห็นล่าสุดไม่เกิน 200 รายการ เพิ่ม pagination เมื่อจำเป็นต้องดูประวัติมากกว่านี้ ระบบจำกัดความถี่การเข้าสู่ระบบและการเขียนข้อมูล โดยเก็บตัวนับในฐานข้อมูลเพื่อใช้ร่วมกันข้าม serverless instances

## รูปภาพในโพสต์

เลือกไฟล์ JPG, PNG หรือ WebP ต้นฉบับไม่เกิน 10 MiB ผ่านปุ่มแนบรูป ระบบปรับด้านยาวไม่เกิน 1,600px และบีบอัดเป็น JPEG อัตโนมัติก่อนส่ง โดยจำกัดรูปที่จัดเก็บไม่เกิน **1 MiB ต่อโพสต์** โพสต์เฉพาะรูปโดยไม่ใส่ข้อความได้ รูปเก็บเป็น binary ในตาราง `post_images` ของ Turso แยกจากข้อมูลโพสต์ และถูกลบตามเมื่อเจ้าของลบโพสต์ ใช้ schema และพฤติกรรมเดียวกันทั้ง local และ production ไม่ต้องตั้งค่า storage service เพิ่ม

วิธีนี้เหมาะกับ Final Project ที่จำกัดจำนวนและขนาดรูป หากมีรูปจำนวนมากหรือมีการเข้าชมสูง ให้ย้าย binary ไป object storage และเก็บเฉพาะตำแหน่งรูปในฐานข้อมูล

## Environment variables

| โฟลเดอร์ | ตัวแปร | ค่า/หน้าที่ |
| --- | --- | --- |
| frontend | `VITE_API_URL` | URL ของ API รวม `/api` เช่น `http://localhost:3001/api` |
| backend | `TURSO_DATABASE_URL` | development: `file:local.db`; production: URL `libsql://` ของฐานข้อมูล Turso |
| backend | `TURSO_AUTH_TOKEN` | token ของฐานข้อมูล Turso เฉพาะ backend |
| backend | `FRONTEND_URL` | origin ของ frontend ที่อนุญาต คั่นด้วย comma หากมีหลาย origin |
| backend | `PORT` | local API port ค่าเริ่มต้น `3001` |

เก็บ secret ใน `backend/.env` หรือ Vercel Environment Variables ห้ามใส่ `TURSO_AUTH_TOKEN` ในตัวแปรที่ขึ้นต้นด้วย `VITE_` และห้าม commit `.env`

## Deploy บน Vercel

ใช้ Vercel สอง projects แยก Root Directory จาก source ใน GitHub repository เดียวกัน:

| การตั้งค่า | Frontend | Backend |
| --- | --- | --- |
| Project | `pulse-social-frontend` | `pulse-social-backend` |
| Root Directory | `frontend` | `backend` |
| Framework | Vite | Express |
| Install Command | `cd .. && npm ci` | `cd .. && npm ci` |
| Build Command | `npm run build` | ค่าเริ่มต้นของ Express |
| Output Directory | `dist` | ค่าเริ่มต้นของ Express |
| Node.js | `24.x` | `24.x` |

1. สร้างฐานข้อมูล **libSQL** บน Turso และ database token สำหรับโปรเจกต์นี้
2. ตั้ง `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `FRONTEND_URL` ที่ Vercel project **backend** ให้ตรง production origin ของ frontend
3. ใส่ URL/token เดียวกันใน `backend/.env` ชั่วคราว แล้วรัน `npm run db:migrate` เพื่อสร้างตารางบน Turso ก่อนใช้งาน จากนั้นคืนค่า `.env` หากต้องการพัฒนากับฐานข้อมูล local
4. Deploy backend แล้วตั้ง `VITE_API_URL=https://<backend-domain>/api` ที่ Vercel project **frontend** และ deploy frontend
5. ทดสอบสมัครสมาชิก เข้าสู่ระบบ โพสต์ Like และ Comment บน production หลัง deploy

ให้ Vercel รวม source นอก Root Directory เพื่อเข้าถึง root `package-lock.json` ของ npm workspace ทั้งสอง projects และอย่าใช้ `file:local.db` เป็น production database เพราะ filesystem ของ serverless ไม่ใช่ที่เก็บข้อมูลถาวร

เอกสารอ้างอิง: [Express บน Vercel](https://vercel.com/docs/frameworks/backend/express), [Vercel monorepos](https://vercel.com/docs/monorepos), [Drizzle + Turso](https://orm.drizzle.team/docs/sqlite/connect-turso), [Turso บน Vercel](https://docs.turso.tech/integrations/vercel)

GitHub repository: [PaweenSan/pulse-social](https://github.com/PaweenSan/pulse-social)

Production: [Pulse Social](https://pulse-social-frontend-rust.vercel.app) · [Backend health](https://pulse-social-backend.vercel.app/api/health)

Frontend และ backend deploy บน Vercel แยก projects แล้ว เชื่อมกับฐานข้อมูล Turso จริง ตรวจสอบ API health, อ่านโพสต์ และ CORS ของ production ผ่านแล้ว บัญชี GitHub **PaweenSan** เชื่อมกับ Vercel **eartbhip06-1961** เรียบร้อย

ตรวจสอบบน browser ของ production แล้ว: เข้าสู่ระบบ สร้าง/แก้ไขโพสต์ Like/Unlike Comment แก้ไขโปรไฟล์ ค้นหา ออกจากระบบ และข้อมูลยังคงอยู่หลัง reload; หน้าจอมือถือ 320/390px ไม่มีเนื้อหาล้นแนวนอน ไม่พบ browser errors บัญชีและเนื้อหาที่ใช้ตรวจสอบถูกลบออกหลังทดสอบ

ฟังก์ชันรูปภาพตรวจสอบด้วยไฟล์ JPEG จริงบน production ทั้งโพสต์พร้อมข้อความและรูปอย่างเดียว รูปยังแสดงหลัง reload/หน้าโปรไฟล์และบนมือถือ 390px; ทดสอบรูป PNG ขนาด 1 MiB เต็มผ่าน API แล้วได้ binary กลับตรงทุก byte การลบโพสต์ลบรูปตามและ URL รูปตอบ 404 ข้อมูลทดสอบทั้งหมดถูกลบโดยไม่เปลี่ยนข้อมูลผู้ใช้อื่น

Release ปัจจุบัน deploy ผ่าน **Vercel CLI** การ deploy อัตโนมัติเมื่อ push ยังไม่ได้ตั้งค่า เพราะ Vercel GitHub App ยังไม่มีสิทธิ์เข้าถึง private repository นี้ ไม่กระทบเว็บไซต์ที่ deploy แล้ว หากต้องการเปิด auto-deploy ภายหลัง ให้สิทธิ์เฉพาะ repository นี้แล้วเชื่อมทั้งสอง projects

อัปเดต production ผ่าน CLI จาก root folder หลังทดสอบและตั้ง environment variables แล้ว:

```sh
vercel link --yes --scope earth4 --project pulse-social-backend
vercel --prod --yes
vercel link --yes --scope earth4 --project pulse-social-frontend
vercel --prod --yes
```

ไฟล์ `.vercelignore` ป้องกัน `.env`, local database และ build files ไม่ให้อัปโหลดจากเครื่องไปเป็น deployment source ใช้ร่วมกับ `.gitignore` เสมอ
