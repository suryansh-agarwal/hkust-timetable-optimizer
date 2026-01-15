This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Course Index

The app uses a static course index for fast client-side search. This avoids dependency on the backend catalog endpoints which may timeout on free-tier hosting.

### Building the Course Index

To generate/update the course index, run from the repository root:

```bash
# Start the local backend first
cd api && uvicorn main:app --reload --port 8000

# Test the subjects endpoint (should return JSON with subjects array)
curl -sS "http://127.0.0.1:8000/wcq/subjects?term=2530" | head

# In another terminal, build the index
python scripts/build_course_index.py \
  --term 2530 \
  --api-base http://127.0.0.1:8000 \
  --out web/public/course-index/2530.json
```

The script will:
1. Fetch all subjects for the term
2. Fetch courses for each subject
3. Extract only essential data (course_code, title, units, subject)
4. Output a compact JSON file

**Commit the generated JSON** so Vercel serves it statically.

### Multiple Terms

To support multiple terms, run the script for each term:

```bash
python scripts/build_course_index.py --term 2530 --api-base http://127.0.0.1:8000 --out web/public/course-index/2530.json
python scripts/build_course_index.py --term 2540 --api-base http://127.0.0.1:8000 --out web/public/course-index/2540.json
```

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
