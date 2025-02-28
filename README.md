# ByteReserve
The goal of this application is to provide a convenient, privacy-focused pay-as-you-go file storage service with client-side encryption, while doing as little work on the server as possible.

It wraps BackBlaze B2's S3-compatible API with a simple, user-friendly interface build with Inertia and Vue.

## How it works
- Users will top up a "wallet" with a certain amount of money whenever they want, with no subscription.
- They will choose an amount of storage to pay for, by the gigabyte.
- They will be billed from their wallet daily based on how much storage they've used.
- The user can choose whether to encrypt a file on upload, and encrypted files will be decrypted on download.
- The encryption password never touches the server, and the salt is stored in the file itself.