# ByteReserve
The goal of this application is to provide a convenient, privacy-focused pay-as-you-go file storage service with client-side encryption, while doing as little work on the server as possible.

## The problem with current file hosting services

Current file hosting services have rigid pricing models that don't fit real usage patterns. Need to share a large file? You're forced into subscriptions with excess storage or hit with arbitrary limits. Authentication is siloed, encryption is inconsistent, and long-term storage requires ongoing commitments.

## The solution
A streamlined file hosting service that offers:

- Automatic "Pay-by-the-gigabyte" pricing with a wallet system (think Steam Wallet)
- No forced subscriptions or unexpected charges
- Built-in client-side encryption and decryption for sensitive files
- Flexible login options including social media accounts and the ability to link accounts together
- Simple long-term storage without commitments
- Temporary files
- No email spam
- Nice social embeds
- Quickly share encrypted files with the key inside the link `#` (keys never sent to the server)

## Technical Approach

Built on S3-compatible storage with a modern web stack that prioritizes browser-side processing. This architecture enhances privacy, performance, and cost-efficiency while allowing deployment on minimal infrastructure.

__Tech Stack__
- Laravel 12 backend
- Inertia.js
- Vue.js frontend, built with Vite
- Tailwind CSS
- TypeScript
- BackBlaze B2