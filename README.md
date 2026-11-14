# NoAdFrame — Watch. Enjoy. No Ads.

ფილმების აღმოჩენის საიტი: ძებნა სახელით/ჟანრით/წლით/რეიტინგით, რეალური IMDb რეიტინგები (OMDb), გვერდზე ჩაშენებული ვიდეოპლეერი, რეგისტრაცია/ავტორიზაცია (bcrypt + JWT), კომენტარები და **NoAdFrame AI Assistant**, რომელიც მხოლოდ საიტის ფარგლებში მუშაობს.

## რა შეიცვალა საწყის პროექტთან შედარებით

- ახალი სახელი და ბრენდინგი **NoAdFrame** ყველგან; ლოგო გამჭვირვალე PNG-ად (`public/assets/logo.png`), ტექსტი ნარინჯისფერი → თეთრი gradient-ით (#FF8C00 → #FFFFFF); იგივე ლოგო არის AI ასისტენტის ავატარიც.
- ახალი Dark Cinematic დიზაინი: Home, Movies, Genres, About, Login/Register, Profile, ფილმის გვერდი.
- მთავარზე: გამორჩეული ფილმის ბანერი + Popular / Top Rated / New Releases.
- ძებნა და ფილტრები: სახელი, ჟანრი, წელი, მინიმალური IMDb რეიტინგი, დალაგება.
- ფილმის გვერდი: პოსტერი, ქართული და ინგლისური სათაური, წელი, IMDb, ჟანრი, რეჟისორი, მსახიობები, აღწერა, ჩაშენებული პლეერი, კომენტარები (წერა, საკუთარის წაშლა, დალაგება).
- პროფილი, პაროლის შეცვლა, Logout.
- მონაცემთა ბაზის სქემა დაყვანილია თქვენი სპეციფიკაციის მიხედვით (`username`, `password`, `release_year`, `poster_url`, `backdrop_url`, `description`, `comment`) + `ai_feedback` ცხრილი. თუ ძველი საწყისი პროექტის ცხრილები უკვე გაქვთ ბაზაში, სერვერი სტარტზე ავტომატურად გადაარქმევს ძველ სვეტებს (`lib/migrate.js`) და მონაცემები არ იკარგება.
- უსაფრთხოება: rate limiting, ვალიდაცია, ერთიანი შეცდომების დამუშავება, CSP header-ები.

## მოთხოვნები

- Node.js 20 ან უფრო ახალი
- TiDB Cloud (ან MySQL) ბაზა
- OMDb API გასაღები: https://www.omdbapi.com/apikey.aspx
- OpenAI API გასაღები: https://platform.openai.com/api-keys

## 0. სწრაფი ვიზუალური გადახედვა (ბაზისა და გასაღებების გარეშე)

```bash
npm run preview
```

გახსენით http://localhost:3100 — სრული საიტი დემო მონაცემებით (პოსტერები და რეიტინგები სატესტოა). ბაზა, `.env` და `npm install` საჭირო არ არის.

## 1. პაკეტების დაინსტალირება

```bash
cd noadframe
npm install
```

## 2. TiDB Cloud-თან დაკავშირება

1. https://tidbcloud.com → შექმენით **Starter** (უფასო) cluster.
2. ბაზის შესაქმნელად გახსენით **SQL Editor** და გაუშვით: `CREATE DATABASE noadframe;` (ან გამოიყენეთ არსებული ბაზა).
3. Cluster-ზე დააჭირეთ **Connect** → Connect with: **General / Node.js** → შექმენით პაროლი. მიიღებთ host-ს, port-ს (4000), user-სა და პაროლს.
4. ააწყვეთ connection string `.env`-ისთვის:

   ```
   DATABASE_URL=mysql://USER:PASSWORD@HOST:4000/noadframe
   ```

   თუ პაროლში სპეციალური სიმბოლოებია (`@`, `#`, `/`, `:`), URL-encode გააკეთეთ (მაგ. `@` → `%40`).
5. TLS ავტომატურად ჩართულია. ლოკალური MySQL-ისთვის TLS-ის გარეშე დაწერეთ `DB_SSL=false`.
6. ცხრილებს სერვერი თავად ქმნის სტარტზე (`sql/schema.sql`). სურვილის შემთხვევაში იგივე ფაილი SQL Editor-შიც შეგიძლიათ გაუშვათ ხელით.

## 3. API გასაღებების შევსება

```bash
cp .env.example .env      # Windows: copy .env.example .env
```

გახსენით `.env` და შეავსეთ:

| ცვლადი | რა არის |
|---|---|
| `DATABASE_URL` | TiDB Cloud connection string |
| `JWT_SECRET` | გრძელი შემთხვევითი სტრიქონი (32+ სიმბოლო). შექმნა: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `OMDB_API_KEY` | OMDb გასაღები — რეალური IMDb რეიტინგისთვის |
| `OPENAI_API_KEY` | OpenAI გასაღები — AI ასისტენტისთვის |
| `OPENAI_MODEL` | მოდელი (ნაგულისხმევი `gpt-4.1-mini`) |
| `ADMIN_EMAIL` | იმ ანგარიშის ელფოსტა, რომელსაც ფილმების დამატება/წაშლა შეუძლია |

`.env` არასოდეს ატვირთოთ GitHub-ზე (`.gitignore`-ში უკვე წერია). გასაღებები მხოლოდ სერვერზეა, Frontend-ში არსად ჩანს.

## 4. Backend-ისა და საიტის გაშვება ლოკალურად

```bash
npm start
```

გახსენით http://localhost:3000 — Backend და Frontend ერთი Express სერვერიდან მუშაობს. შემოწმება: http://localhost:3000/api/health. განვითარებისას გამოიყენეთ `npm run dev` (ავტომატური გადატვირთვა).

## 5. ფილმების დამატება

IMDb რეიტინგი, ჟანრი, რეჟისორი, მსახიობები, წელი და აღწერა ყოველთვის OMDb-დან მოდის — არაფერი გამოგონილი არ არის. ქართული სათაური, პოსტერი, backdrop და ვიდეო მისამართი თქვენ მოგაქვთ.

**ვარიანტი A — seed სკრიპტი.** `seed/movies.json`-ში არის 8 საზოგადოებრივ საკუთრებაში/ღია ლიცენზიით არსებული ფილმის მაგალითი:

```bash
npm run seed
```

**ვარიანტი B — Admin API.** დარეგისტრირდით საიტზე `ADMIN_EMAIL`-ის ელფოსტით, შედით ანგარიშში და გაგზავნეთ (JWT ტოკენი არის `localStorage`-ში `noadframe_token` გასაღებით):

```bash
curl -X POST http://localhost:3000/api/admin/movies \
  -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \
  -d '{"imdbId":"tt0111161","titleKa":"შოუშენკის გამოსყიდვა","posterUrl":"https://...","backdropUrl":"https://...","videoUrl":"https://..."}'
```

წასაშლელად: `DELETE /api/admin/movies/:id`. იგივე `imdbId`-ით ხელახლა გაგზავნა განაახლებს მონაცემებს და რეიტინგს.

### პოსტერები
თუ `posterUrl` არ მიუთითეთ, OMDb-ის მიერ დაბრუნებული პოსტერის მისამართი გამოიყენება. ეს პოსტერები საავტორო უფლებით დაცულია — საჯარო გაშვებამდე დარწმუნდით, რომ მათი გამოყენების უფლება გაქვთ, ან მიუთითეთ საკუთარი/ლიცენზირებული სურათი `posterUrl`/`backdropUrl`-ში. მთავარი ბანერი იყენებს `backdrop_url`-ს, ხოლო თუ ის არ არის — პოსტერს.

### ვიდეო (მხოლოდ ლეგალური წყაროები)
პლეერი იღებს:
- პირდაპირ `.mp4` / `.webm` / `.ogg` ფაილს;
- YouTube, Vimeo ან archive.org embed/details მისამართს.

გამოიყენეთ მხოლოდ ვიდეო, რომლის გავრცელების უფლებაც გაქვთ ან რომელიც საჯარო დომენშია/აქვს ღია ლიცენზია. Seed ფაილში ვიდეო მისამართები მითითებულია მხოლოდ 3 ფილმზე (Night of the Living Dead — archive.org; Big Buck Bunny და Sintel — Blender-ის ღია ფილმები). **ეს მისამართები არ შემომიმოწმებია ონლაინ**, ამიტომ გაუშვით და გადაამოწმეთ; დანარჩენ ფილმებზე ვიდეო ცარიელია და საიტი აჩვენებს "Video is not available". სხვა ჰოსტის დასამატებლად განაახლეთ `embedFor()` (`public/app.js`) და CSP `frame-src`/`media-src` (`server.js`).

## 6. კატეგორიები მთავარ გვერდზე

- **Popular** — ყველაზე ნახვადი
- **Top Rated** — უმაღლესი IMDb რეიტინგი
- **New Releases** — უახლესი გამოშვების წელი

ნახვები იზრდება ფილმის გვერდის გახსნისას, ამიტომ ახალ ბაზაზე თავიდან Popular/Trending თითქმის იგივე თანმიმდევრობით იქნება, სანამ მომხმარებლები საიტს გამოიყენებენ.

## 7. AI ასისტენტი

- გასაღები მხოლოდ სერვერზეა (`POST /api/assistant`).
- ასისტენტი პასუხობს ფილმებზე, რეკომენდაციებზე (მხოლოდ თქვენი კატალოგიდან), საიტის გამოყენებაზე, პაროლის შეცვლაზე, ვიდეოს პრობლემებზე და იღებს უკუკავშირს (ინახება `ai_feedback` ცხრილში).
- შეზღუდვა ორ დონეზეა: system prompt-ით და სერვერზე — მოდელი თითოეულ პასუხს კლასიფიცირებს, `off_topic` პასუხი კი სერვერის მიერ ჩანაცვლდება ფიქსირებული უარით (მაგ. "Solve my mathematics homework" უარყოფილი იქნება). პრომპტ-ინჯექციისგან 100%-იანი დაცვა არცერთ LLM-ზე ვერ გარანტირდება; ამიტომაც ასისტენტს არანაირი ქმედების უფლება (ბაზის ცვლილება და ა.შ.) არ აქვს.

## 8. ონლაინ განთავსება (Render)

1. ატვირთეთ პროექტი GitHub-ზე (`.env` გარეშე).
2. https://render.com → **New → Web Service** → აირჩიეთ რეპოზიტორია.
3. Runtime: Node. Build command: `npm install`. Start command: `npm start`.
4. **Environment** განყოფილებაში დაამატეთ `.env`-ის ყველა ცვლადი (`DATABASE_URL`, `JWT_SECRET`, `OMDB_API_KEY`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `ADMIN_EMAIL`).
5. TiDB Cloud-ში, თუ IP allowlist გაქვთ ჩართული, დაუშვით Render-ის გამავალი IP-ები (ან გახსენით წვდომა სატესტოდ).
6. Deploy-ის შემდეგ გაუშვით seed ერთხელ ლოკალურად (იმავე `DATABASE_URL`-ით) ან გამოიყენეთ Admin API.
7. საკუთარი დომენი: Render → Settings → Custom Domains. თუ Frontend სხვა დომენზე გაქვთ, დაამატეთ `CORS_ORIGIN=https://your-domain.com`.

სხვა ჰოსტინგი (Railway, Fly.io, VPS) იგივენაირად მუშაობს: ნებისმიერი Node 20+ გარემო, `npm start` და იგივე ცვლადები.

## 9. API

| Method | Path | წვდომა |
|---|---|---|
| GET | `/api/health` | საჯარო |
| POST | `/api/auth/register`, `/api/auth/login` | საჯარო |
| GET | `/api/auth/me` | JWT |
| POST | `/api/auth/change-password` | JWT |
| GET | `/api/movies?q=&genre=&year=&minRating=&sort=&limit=` | საჯარო |
| GET | `/api/movies/categories` | საჯარო |
| GET | `/api/genres` | საჯარო |
| GET | `/api/movies/:id` | საჯარო |
| GET | `/api/movies/:id/comments?sort=newest\|oldest` | საჯარო |
| POST | `/api/movies/:id/comments` | JWT |
| DELETE | `/api/comments/:id` | JWT (საკუთარი ან admin) |
| POST / DELETE | `/api/admin/movies`, `/api/admin/movies/:id` | JWT + `ADMIN_EMAIL` |
| POST | `/api/assistant` | საჯარო (rate-limited) |

## 10. საჯაროდ გაშვებამდე

- JWT ინახება `localStorage`-ში; ეს მარტივია, მაგრამ XSS-ის შემთხვევაში მოწყვლადია. საიტი ყველა მონაცემს escape-ს უკეთებს და CSP-ს იყენებს, მაგრამ უფრო მკაცრი მოდელისთვის გადადით httpOnly cookie-ზე.
- დაამატეთ ელფოსტის დადასტურება, პაროლის აღდგენა და კომენტარების მოდერაცია.
- შეზღუდეთ OpenAI გასაღების ხარჯი თქვენს OpenAI ანგარიშში (usage limit).
- ბაზისთვის გამოიყენეთ შეზღუდული უფლებების მქონე მომხმარებელი და ჩართეთ backup.

## ფაილების სტრუქტურა

```
server.js            Express API + static hosting
lib/                 db.js, migrate.js, movies.js (OMDb import)
sql/schema.sql       ცხრილები
scripts/seed.js      ფილმების იმპორტი
seed/movies.json     იმპორტის სია
public/              index.html, styles.css, app.js, assets/ (logo.png, favicon.png)
.env.example
```


## ცვლილებები (2026-11)
- მთავარ გვერდზე Trending Movies სექცია ამოღებულია.
- გამორჩეული ფილმის შერჩევისას პრიორიტეტი ენიჭება Mickey 17-ს, შემდეგ The Holdovers-ს; მათი შესაბამისი backdrop/poster გამოიყენება ფილმის ბანერში.
- About გვერდზე დაემატა გუნდის მიზნის ინგლისური აღწერა.
- HTML5 ვიდეოს გვერდიდან გასვლისას პლეერი ჩერდება და იმავე ფილმზე დაბრუნებისას შენახული დროიდან აგრძელებს. გარე iframe პლეერებიც იხსნება გვერდიდან გასვლისას, თუმცა მათი ზუსტი დროის შენახვა ყველა პროვაიდერზე ერთიანი API-ის არქონის გამო გარანტირებული არ არის.

**უსაფრთხოების შენიშვნა:** ამ ცვლილებებით საიტი სრულად უსაფრთხო არ ხდება და ვიდეოს წყაროს URL-ის დამალვა ჯერ არ არის შესრულებული. ამისთვის საჭიროა ლიცენზირებული ვიდეოწყაროების სერვერული proxy/streaming არქიტექტურა და პროვაიდერების წესებთან შესაბამისობა; YouTube/Vimeo ტიპის iframe-ის წყაროს სრულად დამალვა ბრაუზერისგან ტექნიკურად შეუძლებელია. არასანქცირებული ფილმების წყაროების დამალვაში ან უფლებების მფლობელებისგან მათი დაფარვაში დახმარებას ვერ გავუწევ.
