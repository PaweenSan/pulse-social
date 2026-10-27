# Pulse Social

Final Project เว็บไซต์ Social Media ด้วย **Vue.js 3 + Vite**, **Express.js**, **Drizzle ORM** และ **Turso (libSQL)** แยก frontend และ backend ชัดเจนใน repository เดียว

## ฟังก์ชัน

- สมัครสมาชิก เข้าสู่ระบบ และออกจากระบบ
- ดูและแก้ไขโปรไฟล์
- สร้าง แก้ไข และลบโพสต์ของตนเอง
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

ใช้ Vercel สอง projects เชื่อม GitHub repository เดียวกัน:

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
