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
| `NODE_ENV` | production-ზე დააყენეთ `production` — Secure cookie-ებისა და production შემოწმებებისთვის |
| `RESEND_API_KEY` | Resend API key პაროლის აღდგენის წერილებისთვის (production-ში სავალდებულოა) |
| `MAIL_FROM` | დადასტურებული გამომგზავნის მისამართი Resend-ში |
| `APP_BASE_URL` | საიტის სრული HTTPS მისამართი reset ბმულისთვის (production-ში სავალდებულოა) |
| `PASSWORD_RESET_URL` | სურვილისამებრ, reset გვერდის სრული URL; ნაგულისხმევი `/#/reset-password` |

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

**ვარიანტი B — Admin API.** დარეგისტრირდით საიტზე `ADMIN_EMAIL`-ის ელფოსტით და შედით ანგარიშში. სესია ინახება `HttpOnly` cookie-ში; API-ის მოთხოვნებს სჭირდება იგივე cookie და CSRF header. `curl`-ის მაგალითი:

```bash
curl -c cookies.txt -b cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" -d '{"email":"ADMIN_EMAIL","password":"YOUR_PASSWORD"}'
CSRF=$(awk '$6 == "noadframe_csrf" {print $7}' cookies.txt)
curl -b cookies.txt -X POST http://localhost:3000/api/admin/movies \
  -H "X-CSRF-Token: $CSRF" -H "Content-Type: application/json" \
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
3. Runtime: Node. Build command: `npm ci`. Start command: `npm start`.
4. **Environment** განყოფილებაში დაამატეთ `.env`-ის ცვლადები, მათ შორის `NODE_ENV=production`, `DATABASE_URL`, `JWT_SECRET`, `OMDB_API_KEY`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `ADMIN_EMAIL`, `RESEND_API_KEY`, `MAIL_FROM` და `APP_BASE_URL`.
5. TiDB Cloud-ში, თუ IP allowlist გაქვთ ჩართული, დაუშვით Render-ის გამავალი IP-ები (ან გახსენით წვდომა სატესტოდ).
6. Deploy-ის შემდეგ გაუშვით seed ერთხელ ლოკალურად (იმავე `DATABASE_URL`-ით) ან გამოიყენეთ Admin API.
7. საკუთარი დომენი: Render → Settings → Custom Domains. თუ Frontend სხვა დომენზე გაქვთ, დაამატეთ `CORS_ORIGIN=https://your-domain.com`.

სხვა ჰოსტინგი (Railway, Fly.io, VPS) იგივენაირად მუშაობს: ნებისმიერი Node 20+ გარემო, `npm start` და იგივე ცვლადები.


## 9. DDoS და ტრაფიკისგან დაცვა

სერვერს ახლა აქვს რამდენიმე ფენა:

- ყველა მოთხოვნაზე საერთო ლიმიტი: 300 მოთხოვნა/IP-ზე წუთში.
- API-ზე დამატებითი ლიმიტი: 120 მოთხოვნა/IP-ზე წუთში.
- უფრო მკაცრი ზღვარი login/register/password reset/assistant/archive-video/catalogue endpoint-ებისთვის.
- 429 პასუხი და Retry-After/RateLimit-* headers ლიმიტის გადაჭარბებისას.
- JSON body მაქსიმუმ 32 KB; HTTP headers მაქსიმუმ 8 KB და 50 header; headers/body მიღების timeout-ები.
- სურვილისამებრ, Cloudflare-იდან origin-მდე საიდუმლო header, რომ Render-ის პირდაპირი მისამართით Cloudflare WAF-ის გვერდის ავლა გართულდეს.

### საზიარო rate limit რამდენიმე instance-ისთვის (რეკომენდებულია)

თუ აპი ერთზე მეტ instance-ზე გაეშვება, ჩართეთ Upstash Redis REST store. შექმენით Redis ბაზა Upstash-ში და Render-ის Environment-ში დაამატეთ:

| ცვლადი | მნიშვნელობა |
|---|---|
| UPSTASH_REDIS_REST_URL | Upstash-ის HTTPS REST URL |
| UPSTASH_REDIS_REST_TOKEN | Upstash-ის საიდუმლო REST token |

ორივე მნიშვნელობა შეინახეთ მხოლოდ Render-ის Environment-ში — **არ ჩასვათ GitHub-ში ან Frontend-ში**. Counter იზრდება Redis-ის ერთ ატომურ Lua ოპერაციაში და ყველა instance იყენებს ერთსა და იმავე ლიმიტს. Redis-ის შეცდომისას configured rate limiter მოთხოვნას არ ატარებს (fail-closed). თუ ეს ცვლადები არ არის დაყენებული, გამოიყენება პროცესის მეხსიერების store; ეს გამოდგება ერთი instance-ისთვის/ლოკალური ტესტისთვის, მაგრამ რამდენიმე instance-ზე საერთო ლიმიტს ვერ უზრუნველყოფს.

### Cloudflare-ის edge დაცვა

**საკუთარი Cloudflare ანგარიშის შექმნა აუცილებელი არ არის საბაზისო DDoS დაცვისთვის:** Render ყველა განთავსებულ საიტს ავტომატურად იცავს Cloudflare-ის DDoS ინფრასტრუქტურით. ეს ცალკე არ მოითხოვს შენგან Cloudflare ანგარიშს ან DNS ცვლილებას. საკუთარი Cloudflare ანგარიშის დამატება არჩევითია — ის გამოგადგება, თუ გინდა მართო შენი დომენის Proxy, WAF, custom rate-limit და origin header წესები. Render-ის ჩაშენებულ დაცვასა და შენს პირად Cloudflare ზონას ერთმანეთში ნუ აურევ. Endpoint abuse-სთვის აპლიკაციის/Redis rate-limit მაინც საჭიროა.

1. მიაბით საკუთარი დომენი Cloudflare-ს და DNS ჩანაწერზე ჩართეთ Proxy (orange cloud); SSL/TLS რეჟიმი დააყენეთ **Full (strict)**.
2. Cloudflare Security-ში დატოვეთ DDoS managed protection ჩართული და ჩართეთ WAF Managed Rules, როცა ხელმისაწვდომია.
3. შექმენით Rate Limiting rule მინიმუმ /api/*-ზე; ცალკე, უფრო მკაცრი წესები დაუწესეთ /api/auth/login, /api/auth/register, /api/auth/forgot-password და /api/assistant გზებს. API-ზე გამოიყენეთ Block და არა browser challenge, რადგან challenge-მა საიტის fetch() მოთხოვნები შეიძლება დაარღვიოს. ზღვარი მოარგეთ რეალურ ტრაფიკს; Cloudflare-ის rate-limiting ფუნქციები/რაოდენობა გეგმის მიხედვით განსხვავდება.
4. **Origin-ის დაცვა:** Cloudflare-ის Proxy/WAF მარტო არ კმარა, თუ თავდამსხმელს შეუძლია Render-ის *.onrender.com მისამართით პირდაპირ შესვლა. შექმენით შემთხვევითი token:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```
   დაამატეთ Render Environment-ში ORIGIN_ACCESS_TOKEN. Cloudflare Rules → Transform Rules → Modify Request Header-ში დაამატეთ X-Origin-Access-Token იგივე მნიშვნელობით თქვენი საიტის hostname-ისთვის. აპი ამ header-ს ამოწმებს და მის გარეშე პირდაპირ origin-ზე მისულ მოთხოვნას უარყოფს; /api/health გამონაკლისია Render-ის health check-ისთვის. ეს ჩართეთ მხოლოდ მას შემდეგ, რაც Cloudflare header rule მზად იქნება, თორემ საიტზე ჩვეულებრივი წვდომაც დაიბლოკება.
5. Render-ზე TRUST_PROXY_HOPS ნაგულისხმევად არის 1. შეცვალეთ მხოლოდ მაშინ, როცა თქვენი proxy chain-ის რეალური რაოდენობა გადაამოწმეთ; არასოდეს გამოიყენოთ trust proxy = true ან მომხმარებლის მიერ მოწოდებული X-Forwarded-For უპირობოდ.

**მნიშვნელოვანი:** Express-ის rate limit ვერ აჩერებს ქსელურ flood-ს მანამდე, სანამ ტრაფიკი ჰოსტამდე მივა. Render-ის ავტომატური edge DDoS ფენა უკვე მოქმედებს. საკუთარი Cloudflare WAF და origin-ის header-ით დაცვა დამატებითი, არჩევითი ფენებია — გამოიყენე მხოლოდ მაშინ, თუ შენს დომენს საკუთარ Cloudflare ანგარიშში მართავ. ვერცერთი კონფიგურაცია ვერ იძლევა გარანტიას, რომ ყველა ზომის DDoS შეტევა საიტს არასდროს გათიშავს.
## 10. API

| Method | Path | წვდომა |
|---|---|---|
| GET | `/api/health` | საჯარო |
| POST | `/api/auth/register`, `/api/auth/login` | საჯარო |
| GET | `/api/auth/me` | HttpOnly session cookie |
| POST | `/api/auth/logout` | cookie session + CSRF |
| POST | `/api/auth/forgot-password`, `/api/auth/reset-password` | საჯარო (rate-limited) |
| POST | `/api/auth/change-password` | cookie session + CSRF |
| GET | `/api/movies?q=&title=&genre=&year=&minRating=&sort=&page=&limit=` | საჯარო; აბრუნებს `page`, `limit`, `total`, `totalPages`, `movies` |
| GET | `/api/movies/categories` | საჯარო |
| GET | `/api/genres` | საჯარო |
| GET | `/api/movies/:id` | საჯარო |
| GET | `/api/movies/:id/comments?sort=newest\|oldest` | საჯარო |
| POST | `/api/movies/:id/comments` | session cookie + CSRF |
| DELETE | `/api/comments/:id` | session cookie + CSRF (საკუთარი ან admin) |
| POST / DELETE | `/api/admin/movies`, `/api/admin/movies/:id` | session cookie + CSRF + `ADMIN_EMAIL` |
| POST | `/api/assistant` | საჯარო (rate-limited) |

## 11. ავტორიზაცია და პაროლის აღდგენა

- JWT ინახება `HttpOnly`, production-ში `Secure`, `SameSite=Lax` session cookie-ში და JavaScript-იდან არ იკითხება. Unsafe cookie-auth მოთხოვნები ამოწმებს double-submit CSRF token-ს (`X-CSRF-Token`).
- პაროლის აღდგენა იყენებს ერთჯერად SHA-256 token hash-ს და 30 წუთიან ვადას. წერილი იგზავნება Resend-ით; production-ში `RESEND_API_KEY`, `MAIL_FROM` და `APP_BASE_URL` აუცილებელია.
- Reset ფორმა ხელმისაწვდომია `/#/reset-password` მისამართზე; ბმულში token query parameter-ით გადადის.
- ახალი პაროლი უნდა იყოს მინიმუმ 10 სიმბოლო, შეიცავდეს ასოსა და ციფრს.
- შეზღუდეთ OpenAI გასაღების ხარჯი თქვენს OpenAI ანგარიშში (usage limit) და ბაზისთვის გამოიყენეთ შეზღუდული უფლებების მქონე მომხმარებელი და ჩართეთ backup.

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


## 10. Copyright and content compliance (mandatory before public launch)

NoAdFrame must not host, embed, stream, or publicly display a film, poster, backdrop, trailer, soundtrack, subtitle, translation, synopsis, photograph, logo, or other protected material unless the operator has verified a legal basis for that exact asset and the intended use. An IMDb ID, OMDb API response, Archive.org URL, search result, or attribution alone is not a licence.

- The app now stores a separate rights basis, evidence reference, licence URL, and attribution for posters, backdrops, videos, and descriptions.
- Public movie APIs suppress media and descriptions without a recorded rights basis. Existing database rows without rights evidence therefore stop exposing those assets until reviewed and documented.
- The admin movie API requires rights evidence for every media URL and description. Accepted values include original, written_permission, public_domain, cc_by_3, cc_by_4, cc_by_sa, commercial_license, and official_embed. These values are declarations only; an administrator must verify the actual evidence and licence scope.
- Seed data removes unverified commercial streams. Big Buck Bunny and Sintel remain as examples under CC BY 3.0; include the full end credits when screening the entire films and keep the credits intact. Sources: https://peach.blender.org/about/ and https://durian.blender.org/sharing/.
- OMDb metadata access does not grant poster or plot reuse rights. Posters and descriptions are not imported automatically as publishable content.
- A public report form is available at /copyright.html. Set COPYRIGHT_EMAIL in Render to a monitored mailbox; the endpoint requires it, plus RESEND_API_KEY and MAIL_FROM. Reports are stored in copyright_reports and can be reviewed through GET /api/admin/copyright-reports by an administrator; status can be updated through PATCH /api/admin/copyright-reports/:id with status received/reviewing/removed/rejected/restored and optional adminNote.
- Configure and monitor this mailbox daily. Under Article 59(9)-(10) and Article 60¹ of Georgia's Law on Copyright and Related Rights, qualifying written notices have specific content requirements and the intermediary-service procedure includes removal/restriction and written responses within 24 hours. This code stores and forwards reports; it does NOT automatically assess legal validity, remove content, notify every affected uploader, or guarantee statutory compliance. Establish a human on-call process and consult a Georgian IP lawyer before launch.
- Keep the original licence text, signed permissions/contracts, source URLs, dates, territory, duration, monetization rights, streaming/public communication rights, adaptation/dubbing/translation rights, and required credits for each asset. Check rights separately for the film, dubbed soundtrack, subtitles, poster, stills, trailer, and music.
- Never treat “public domain” as global without checking the relevant country, publication history, restoration/score/translation rights and term. A public-domain film may still have a separately protected soundtrack, restoration, poster, or Georgian dub.

The copyright policy page is informational and is not legal advice. The operator should have a Georgian lawyer review the policy, notice workflow, privacy handling and all licences before enabling public streaming.
