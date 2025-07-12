import { route } from 'ziggy-js';

const KEY_LENGTH = 256;
const IV_LENGTH = 12; // 96 bits for AES-GCM
const AUTH_TAG_LENGTH = 16; // 128 bits for AES-GCM auth tag
const SALT_LENGTH = 16; // 128 bits for salt
const CHUNK_SIZE_MB = 16;
const CHUNK_SIZE = CHUNK_SIZE_MB * 1024 * 1024;

// Secure Key Derivation Function (KDF) - Same as upload
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const passwordKey = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(password),
        'PBKDF2',
        false,
        ['deriveKey'],
    );

    return crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: salt.buffer as ArrayBuffer,
            iterations: 100000,
            hash: 'SHA-256',
        },
        passwordKey,
        { name: 'AES-GCM', length: KEY_LENGTH },
        false,
        ['encrypt', 'decrypt'],
    );
}

interface DownloadProgress {
    loaded: number;
    total: number;
    percentage: number;
}

export class S3DownloadService {
    private readonly MAX_CONCURRENT_DOWNLOADS = 5;

    /**
     * Download and decrypt a file
     */
    public async downloadFile(
        fileId: number,
        fileName: string,
        password: string = "password",
        progressCallback?: (progress: DownloadProgress) => void
    ): Promise<Blob> {
        console.log(`Starting download for file ${fileName} (ID: ${fileId})`);

        try {
            // Get the download URL from the API
            const response = await fetch(
                route('files.download.{file}', { file: fileId }),
                {
                    headers: {
                        'X-Requested-With': 'XMLHttpRequest',
                        'X-XSRF-TOKEN': document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || ''
                    }
                }
            );

            
            if (!response.ok) {
                throw new Error(`Failed to get download URL: ${response.statusText}`);
            }
            
            const data = await response.json();
            
            if (!data.download_url) {
                throw new Error('No download URL provided');
            }
            console.log(data.download_url);

            // Download the encrypted file
            const encryptedData = await this.downloadEncryptedFile(data.download_url, progressCallback);
            
            // Check if file is encrypted by looking for salt at the beginning
            const dataView = new Uint8Array(encryptedData);
            
            // If the file is smaller than salt + iv + auth tag, it's likely not encrypted
            if (dataView.length < SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH) {
                console.log('File appears to be unencrypted, returning as-is');
                return new Blob([encryptedData]);
            }

            // Decrypt the file
            const decryptedData = await this.decryptFile(encryptedData, password);
            
            return new Blob([decryptedData]);
        } catch (error) {
            console.error('Download failed:', error);
            throw error;
        }
    }

    /**
     * Download the encrypted file from S3
     */
    private async downloadEncryptedFile(
        downloadUrl: string,
        progressCallback?: (progress: DownloadProgress) => void
    ): Promise<ArrayBuffer> {
        console.log('Downloading encrypted file from S3...');

        const response = await fetch(downloadUrl);
        
        if (!response.ok) {
            throw new Error(`Failed to download file: ${response.statusText}`);
        }

        const contentLength = response.headers.get('Content-Length');
        const totalSize = contentLength ? parseInt(contentLength) : 0;

        if (!response.body) {
            throw new Error('No response body');
        }

        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let loaded = 0;

        try {
            while (true) {
                const { done, value } = await reader.read();
                
                if (done) break;
                
                chunks.push(value);
                loaded += value.length;
                
                if (progressCallback && totalSize > 0) {
                    progressCallback({
                        loaded,
                        total: totalSize,
                        percentage: (loaded / totalSize) * 100
                    });
                }
            }
        } finally {
            reader.releaseLock();
        }

        // Combine all chunks into a single ArrayBuffer
        const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const combinedArray = new Uint8Array(totalLength);
        let offset = 0;

        for (const chunk of chunks) {
            combinedArray.set(chunk, offset);
            offset += chunk.length;
        }

        return combinedArray.buffer;
    }

    /**
     * Decrypt the downloaded file
     */
    public async decryptFile(encryptedData: ArrayBuffer, password: string): Promise<ArrayBuffer> {
        console.log('Starting file decryption...');

        const dataView = new Uint8Array(encryptedData);
        let offset = 0;

        // Extract salt from the beginning of the file
        const salt = dataView.slice(offset, offset + SALT_LENGTH);
        offset += SALT_LENGTH;

        // Derive the key from password and salt
        const cryptoKey = await deriveKey(password, salt);

        // Determine if this is a single chunk or multipart file
        const remainingSize = dataView.length - SALT_LENGTH;
        const isMultipart = remainingSize > CHUNK_SIZE;

        if (!isMultipart) {
            // Single chunk file
            return await this.decryptSingleChunk(dataView, offset, cryptoKey);
        } else {
            // Multipart file
            return await this.decryptMultipartFile(dataView, offset, cryptoKey);
        }
    }

    /**
     * Decrypt a single chunk file
     */
    private async decryptSingleChunk(dataView: Uint8Array, offset: number, cryptoKey: CryptoKey): Promise<ArrayBuffer> {
        // Extract IV
        const iv = dataView.slice(offset, offset + IV_LENGTH);
        offset += IV_LENGTH;

        // Extract encrypted data (includes auth tag)
        const encryptedChunk = dataView.slice(offset);

        // Decrypt the chunk
        const decryptedChunk = await crypto.subtle.decrypt(
            {
                name: 'AES-GCM',
                iv: iv
            },
            cryptoKey,
            encryptedChunk
        );

        return decryptedChunk;
    }

    /**
     * Decrypt a multipart file
     */
    private async decryptMultipartFile(dataView: Uint8Array, offset: number, cryptoKey: CryptoKey): Promise<ArrayBuffer> {
        console.log('Decrypting multipart file...');

        const chunks: { index: number; data: ArrayBuffer }[] = [];
        let chunkIndex = 0;

        // Parse all chunks by finding IV markers
        while (offset < dataView.length) {
            // Each chunk starts with a 12-byte IV
            const iv = dataView.slice(offset, offset + IV_LENGTH);
            offset += IV_LENGTH;

            // We need to find the next IV (or end of file) to determine chunk size
            let nextIvOffset = offset;
            let foundNextIv = false;

            // Look for the next IV position (every chunk except first has IV at start)
            // This is a simplified approach - in practice you might want to try decrypting
            // with different chunk sizes to find the correct boundary
            const maxChunkSize = CHUNK_SIZE + 16; // Add some padding for auth tag
            nextIvOffset = Math.min(offset + maxChunkSize, dataView.length);

            // If this is not the last chunk, we need to find the actual boundary
            if (nextIvOffset < dataView.length) {
                // Try to find the next IV by looking for decryption success
                // This is a brute force approach - could be optimized
                for (let testOffset = offset + CHUNK_SIZE - 100; testOffset <= offset + CHUNK_SIZE + 100 && testOffset < dataView.length - IV_LENGTH; testOffset++) {
                    try {
                        // Try to decrypt a small test chunk at this position
                        const testIv = dataView.slice(testOffset, testOffset + IV_LENGTH);
                        const testData = dataView.slice(testOffset + IV_LENGTH, Math.min(testOffset + IV_LENGTH + 32, dataView.length));
                        
                        if (testData.length >= 16) { // Minimum size for AES-GCM with auth tag
                            await crypto.subtle.decrypt({
                                name: 'AES-GCM',
                                iv: testIv
                            }, cryptoKey, testData);
                            
                            // If we get here, this might be the next chunk boundary
                            nextIvOffset = testOffset;
                            foundNextIv = true;
                            break;
                        }
                    } catch (e) {
                        // This is not a valid chunk boundary, continue searching
                    }
                }
            }

            // Extract the encrypted data for this chunk
            const encryptedData = dataView.slice(offset, nextIvOffset);

            try {
                const decryptedData = await crypto.subtle.decrypt(
                    {
                        name: 'AES-GCM',
                        iv: iv
                    },
                    cryptoKey,
                    encryptedData
                );

                chunks.push({
                    index: chunkIndex,
                    data: decryptedData
                });
            } catch (error) {
                console.error(`Failed to decrypt chunk ${chunkIndex}:`, error);
                throw new Error(`Failed to decrypt chunk ${chunkIndex}`);
            }

            offset = nextIvOffset;
            chunkIndex++;
        }

        // Sort chunks by index and combine them
        chunks.sort((a, b) => a.index - b.index);

        const totalLength = chunks.reduce((sum, chunk) => sum + chunk.data.byteLength, 0);
        const combinedArray = new Uint8Array(totalLength);
        let combineOffset = 0;

        for (const chunk of chunks) {
            combinedArray.set(new Uint8Array(chunk.data), combineOffset);
            combineOffset += chunk.data.byteLength;
        }

        console.log(`Successfully decrypted ${chunks.length} chunks, total size: ${totalLength} bytes`);
        return combinedArray.buffer;
    }

    /**
     * Trigger browser download of the decrypted file
     */
    public static triggerDownload(blob: Blob, fileName: string, onDownloadStart?: () => void): void {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        
        // Add event listener to detect when download starts
        if (onDownloadStart) {
            link.addEventListener('click', onDownloadStart, { once: true });
        }
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        // Clean up the object URL after a delay to ensure download started
        setTimeout(() => {
            URL.revokeObjectURL(url);
        }, 1000);
    }
}