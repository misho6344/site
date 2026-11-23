# NoAdFrame

ფილმების აღმოჩენის საიტი: ძებნა, ფილტრები, IMDb რეიტინგები, ვიდეოპლეერი, კომენტარები და AI ასისტენტი.

## მოთხოვნები

- Node.js 20+
- MySQL 8 (მაგალითად Enzonic)
- OMDb API გასაღები
- OpenAI API გასაღები

## ლოკალურად გაშვება

1. `cp .env.example .env` და შეავსეთ მნიშვნელობები (`DATABASE_URL`, `JWT_SECRET`, `OMDB_API_KEY`, `OPENAI_API_KEY`, `ADMIN_EMAIL`).
2. `npm install`
3. `npm start`
4. გახსენით http://localhost:3000

სწრაფი ვიზუალური ნახვა ბაზის გარეშე: `npm run preview` → http://localhost:3100

## ფილმების დამატება

- საჯარო დომენის ან ლიცენზირებული ფილმები: `npm run seed`
- ან Admin API-ით (საჭიროა `ADMIN_EMAIL` ანგარიში).

რეიტინგი, ჟანრი და აღწერა OMDb-დან მოდის.

## Render-ზე განთავსება

- Build: `npm ci`, Start: `npm start`
- Environment-ში დაამატეთ ყველა ცვლილება `.env`-დან, მათ შორის `NODE_ENV=production`.
- `.env` არასდროს ატვირთოთ GitHub-ზე.

## უსაფრთხოება

- გასაღებები მხოლოდ სერვერზე ინახება.
- პაროლის აღდგენა: Resend (`RESEND_API_KEY`, `MAIL_FROM`, `APP_BASE_URL`).
- ფორმა: `/copyright.html`.

## ⚠️ საავტორო უფლებები

საიტზე ფილმის, პოსტერის ან ვიდეოს გამოქვეყნებამდე აუცილებელია უფლებების შემოწმება. OMDb მონაცემები არ იძლევა პოსტერისა და აღწერის გამოყენების უფლებას. ვიდეოს დამატებამდე დარწმუნდით, რომ გაქვთ გავრცელების უფლება ან ის საჯარო დომენშია.

## API

| მეთოდი | მისამართი | წვდომა |
|---|---|---|
| GET | `/api/movies` | საჯარო |
| GET | `/api/movies/:id` | საჯარო |
| POST | `/api/movies/:id/comments` | შესვლა |
| POST | `/api/assistant` | საჯარო, შეზღუდული |
| POST/DELETE | `/api/admin/movies` | ადმინი |

## ფაილები

- `server.js` — API და სტატიკური ფაილები
- `lib/` — ბაზა, მიგრაცია, OMDb
- `sql/schema.sql` — ცხრილები
- `public/` — ფრონტენდი
- `seed/movies.json` — საწყისი ფილმები
