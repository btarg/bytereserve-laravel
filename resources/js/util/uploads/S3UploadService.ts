﻿import { Files, Folders } from '../database/ModelRegistry';
import { FileRecord } from '../database/Schemas';
import { formatFileSize } from '../FormattingUtils';
import { WorkerPoolManager } from './WorkerPoolManager';
import { route } from 'ziggy-js';

const KEY_LENGTH = 256;
const CHUNK_SIZE_MB = 16;
const IV_LENGTH = 12; // 96 bits for AES-GCM
const AUTH_TAG_LENGTH = 16; // 128 bits for AES-GCM auth tag
const SALT_LENGTH = 16; // 128 bits for salt

// Secure Key Derivation Function (KDF) - Updated for AES-GCM
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
            iterations: 100000, // Increase iterations for stronger security
            hash: 'SHA-256',
        },
        passwordKey,
        { name: 'AES-GCM', length: KEY_LENGTH },
        false,
        ['encrypt', 'decrypt'],
    );
}

export class S3UploadService {
    private readonly CHUNK_SIZE = CHUNK_SIZE_MB * 1024 * 1024;
    private readonly MAX_CONCURRENT_UPLOADS: number;
    private readonly MAX_PREFETCH_CHUNKS = 2;
    private readonly workerPool: WorkerPoolManager;
    private readonly workerCount: number;

    constructor() {
        const cores = navigator.hardwareConcurrency || 4;
        this.workerCount = Math.min(cores, 8);

        const connectionType = (navigator as any).connection?.type;
        const isSlowConnection =
            connectionType === 'cellular' ||
            connectionType === '2g' ||
            connectionType === '3g';

        this.MAX_CONCURRENT_UPLOADS = isSlowConnection
            ? 4
            : Math.min(cores * 2, 16);
        this.workerPool = new WorkerPoolManager(
            '/build/js/workers/file-processor.js',
            this.workerCount,
        );
    }


    public async uploadFile(
        file: File,
        password: string = "password", // Default password for testing
        folderId?: number | null,
        progressCallback?: (progress: number) => void,
        should_encrypt: boolean = true, // Default to encrypted
        expiresAt?: Date | null // Optional expiry time
    ): Promise<any> {
        try {
            console.log(`Starting ${should_encrypt ? "encrypted upload" : "non-encrypted upload"} at folder ${folderId} for ${file.name} (${file.size} bytes)`);
            console.log(`Using ${this.workerCount} workers with ${this.MAX_CONCURRENT_UPLOADS} concurrent uploads`);

            let uploadResult;
            if (file.size < this.CHUNK_SIZE) {
                uploadResult = await this.directUpload(file, password, folderId, should_encrypt, expiresAt);
            } else {
                uploadResult = await this.pipelinedMultipartUpload(
                    file,
                    password,
                    progressCallback,
                    folderId,
                    should_encrypt,
                    expiresAt
                );
            }

            // Use the key from the upload result as the path
            // This is the file's location in the S3 bucket
            const path = uploadResult.key;

            if (!path) {
                throw new Error('No path/key returned from upload process');
            }

            console.log("Saving file record to database:", {
                name: file.name,
                path: path, // Use the S3 key as the path
                mime_type: file.type || 'application/octet-stream',
                size: file.size,
                folder_id: folderId,
            });

            const saveFileResponse = await window.cacheFetch.post(route('files.store'), {
                name: file.name,
                path: path, // Use the S3 key as the path
                mime_type: file.type || 'application/octet-stream',
                size: file.size,
                folder_id: folderId,
                hash: file.name, // TODO: implement hashing
                expires_at: expiresAt ? expiresAt.toISOString() : null
            });

            if (!saveFileResponse.ok) {
                const errorText = await saveFileResponse.text();
                console.error('Failed to save file record:', errorText);
                throw new Error(`Failed to save file record: ${saveFileResponse.status} ${saveFileResponse.statusText}`);
            }

            const data = await saveFileResponse.json();

            // Create file record in local database
            const fileRecord: FileRecord = {
                type: 'file',
                id: data.id,
                name: file.name,
                path: path,
                folder_id: folderId,
                mime_type: file.type || 'application/octet-stream',
                size: file.size,
                created_at: Date.now(),
                updated_at: Date.now(),
                hash: file.name // TODO: implement hashing
            };

            // Save to Dexie
            await Files().save(fileRecord);

            // Update folder sizes locally
            if (folderId !== null && folderId !== undefined) {
                await this.updateFolderSizesRecursively(folderId, file.size);
            }

            return data;
        } catch (error) {
            console.error('Upload failed:', error);

            // Create a pending file record for offline support
            try {
                const fileRecord: FileRecord = {
                    type: 'file',
                    id: `pending_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
                    name: file.name,
                    path: null,
                    folder_id: folderId,
                    mime_type: file.type || 'application/octet-stream',
                    size: file.size,
                    local_blob: file, // Store blob for later upload
                    pending_upload: true,
                    created_at: Date.now(),
                    updated_at: Date.now(),
                    hash: file.name // TODO: implement hashing
                };

                // Save to Dexie
                await Files().save(fileRecord);

                console.log(`File saved locally for future upload: ${file.name}`);
                return null;
            } catch (localSaveError) {
                console.error('Failed to save file locally:', localSaveError);
                throw error;
            }
        }
    }

    /**
     * Update folder size recursively through the parent chain
     * This mimics the server-side behavior of Folder::addFileSize()
     */
    private async updateFolderSizesRecursively(folderId: number, fileSize: number): Promise<void> {
        try {
            // Get the current folder
            const folder = await Folders().find(folderId);
            if (!folder) return;

            // Update the folder size
            const updatedFolder = {
                ...folder,
                size: (folder.size || 0) + fileSize
            };

            // Save the updated folder
            await Folders().save(updatedFolder);
            console.log(`Updated folder ${folder.name} size: ${formatFileSize(updatedFolder.size)}`);

            // If folder has a parent, update it too
            if (folder.parent_id) {
                await this.updateFolderSizesRecursively(folder.parent_id, fileSize);
            }
        } catch (error) {
            console.error('Error updating folder sizes:', error);
        }
    }


    private async directUpload(file: File, password: string, folderId?: number | null, should_encrypt?: boolean, expiresAt?: Date | null): Promise<any> {
        console.log(`Starting direct upload for ${file.name} (${file.size} bytes)`);

        try {
            const response = await window.cacheFetch.post(route('uploads.get-direct-url'), {
                file_name: file.name,
                content_type: file.type || 'application/octet-stream',
                folder_id: folderId
            });

            // the URL is the presigned S3 upload URL
            const responseData = await response.json();
            const { url, key } = responseData;

            // Process the file (encrypt if needed)
            const processedData = await (async () => {
                if (should_encrypt) {
                    // Generate a unique salt for this file
                    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
                    
                    // Derive the key from the password and salt
                    const cryptoKey = await deriveKey(password, salt);
                    
                    // Process file with worker pool
                    const result = await this.processFileWithWorkerPool(
                        file,
                        0,
                        file.size,
                        cryptoKey
                    );

                    if (result.error) {
                        throw new Error(`Failed to encrypt file: ${result.error}`);
                    }

                    // Prepend salt to the encrypted data
                    let finalData: ArrayBuffer | Blob;
                    if (result.chunk instanceof Blob) {
                        // If result is a Blob, create a new blob with salt prepended
                        const saltBuffer = new ArrayBuffer(salt.byteLength);
                        new Uint8Array(saltBuffer).set(salt);
                        finalData = new Blob([saltBuffer, result.chunk], { type: file.type });
                    } else {
                        // If result is an ArrayBuffer, create a new ArrayBuffer with salt prepended
                        const encryptedData = new Uint8Array(result.chunk);
                        const finalBuffer = new Uint8Array(salt.byteLength + encryptedData.byteLength);
                        finalBuffer.set(salt, 0);
                        finalBuffer.set(encryptedData, salt.byteLength);
                        finalData = finalBuffer.buffer;
                    }

                    return { chunk: finalData };
                } else {
                    return { chunk: file };
                }
            })();

            // Upload the processed data
            const uploadResponse = await fetch(url, {
                method: 'PUT',
                body: processedData.chunk,
                headers: {
                    'Content-Type': file.type || 'application/octet-stream',
                    'Content-Length':
                        processedData.chunk instanceof Blob
                            ? String(processedData.chunk.size)
                            : String((processedData.chunk as ArrayBuffer).byteLength),
                },
            });

            if (!uploadResponse.ok) {
                throw new Error(`Failed to upload file: ${uploadResponse.statusText}`);
            }

            const fileDetails = {
                key: key,
                contentType: file.type || 'application/octet-stream',
                contentLength: file.size,
                lastModified: new Date().toISOString(),
            };

            return fileDetails;
        } catch (error) {
            console.error('Direct upload failed:', error);
            throw error;
        }
    }

    private async pipelinedMultipartUpload(
    file: File,
    password: string,
    progressCallback ?: (progress: number) => void,
    folderId ?: number | null,
    should_encrypt ?: boolean,
    expiresAt?: Date | null
): Promise < any > {
    const totalStart = performance.now();
    const totalChunks = Math.ceil(file.size / this.CHUNK_SIZE);
    let uploadId: string | null = null;
    let key: string | null = null;
    let uploadedChunks = 0;
    let lastReportedProgress = 0;

    let cryptoKey: CryptoKey | null = null;

    // Track performance metrics
    const metrics = {
        encryptionTime: 0,
        uploadTime: 0,
        initTime: 0,
        completeTime: 0,
        totalTime: 0,
        chunkTimes: [] as Array<{
            partNumber: number,
            encryptionMs: number,
            uploadMs: number,
            size: number,
            uploadSpeed: number // MB/s
        }>
    };

    const processingQueue = new Map<
        number,
        Promise<{
            partNumber: number;
            chunk: Blob | ArrayBuffer;
            encryptionTime: number;
        }>
    >();

    const uploadQueue: Array<{
        partNumber: number;
        chunk: Blob | ArrayBuffer;
    }> =[];

    const uploadedParts: {
        PartNumber: number; ETag: string
}[] = [];

try {
    console.log(
        `Starting pipelined multipart upload for ${file.name} (${file.size} bytes, ${totalChunks} chunks)`,
    );

    const initStart = performance.now();
    const initResponse = await window.cacheFetch.post(route("uploads.initiate-multipart"), {
        file_name: file.name,
        content_type: file.type || 'text/plain',
        folder_id: folderId
    });

    metrics.initTime = performance.now() - initStart;
    console.log(`Upload initialization took ${metrics.initTime.toFixed(2)}ms`);

    const initData = await initResponse.json();

    uploadId = initData.uploadId;
    key = initData.key;

    if (!uploadId || !key) {
        throw new Error('No upload ID or key received');
    }

    const urlStart = performance.now();
    const partNumbers = Array.from({ length: totalChunks }, (_, i) => i + 1);
    const bulkUrlResponse = await window.cacheFetch.post(route('uploads.get-part-url'), {
        uploadId,
        key,
        partNumbers,
    });
    const urlTime = performance.now() - urlStart;
    console.log(`Getting ${totalChunks} presigned URLs took ${urlTime.toFixed(2)}ms`);

    const bulkData = await bulkUrlResponse.json();
    const partUrls = bulkData.urls;

    let salt: Uint8Array | null = null;
    if (should_encrypt) {
        // Generate a unique salt for this file
        salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));

        // Derive the key from the password and salt
        const deriveStart = performance.now();
        cryptoKey = await deriveKey(password, salt);
        metrics.encryptionTime += performance.now() - deriveStart;
    }

    const processChunk = async (
        partNumber: number,
    ): Promise<{ partNumber: number; chunk: Blob | ArrayBuffer; encryptionTime: number }> => {
        const start = (partNumber - 1) * this.CHUNK_SIZE;
        const end = Math.min(start + this.CHUNK_SIZE, file.size);
        const chunkSize = end - start;

        const encryptStart = performance.now();
        const processedData = await (async () => {
            if (should_encrypt) {
                // Use worker pool for encryption
                const result = await this.processFileWithWorkerPool(
                    file,
                    start,
                    chunkSize,
                    cryptoKey
                );

                // For the first chunk, prepend the salt
                if (partNumber === 1) {
                    let finalData: Blob | ArrayBuffer;
                    if (result.chunk instanceof Blob) {
                        // Convert salt to ArrayBuffer for Blob compatibility
                        const saltBuffer = new ArrayBuffer(salt.byteLength);
                        new Uint8Array(saltBuffer).set(salt);
                        finalData = new Blob([saltBuffer, result.chunk], { type: file.type });
                    } else {
                        const encryptedData = new Uint8Array(result.chunk);
                        const finalBuffer = new Uint8Array(salt.byteLength + encryptedData.byteLength);
                        finalBuffer.set(salt, 0);
                        finalBuffer.set(encryptedData, salt.byteLength);
                        finalData = finalBuffer.buffer;
                    }
                    return { chunk: finalData };
                }

                return result;
            } else {
                const chunk = file.slice(start, end);
                return { chunk };
            }
        })();
        const encryptTime = performance.now() - encryptStart;

        return {
            partNumber,
            chunk: processedData.chunk,
            encryptionTime: encryptTime
        };
    };

    const uploadChunk = async (
        partNumber: number,
        chunk: Blob | ArrayBuffer,
        encryptionTime: number
    ): Promise<{
        PartNumber: number;
        ETag: string;
    }> => {
        const partUrl = partUrls[partNumber];
        if (!partUrl) {
            throw new Error(`No URL found for part ${partNumber}`);
        }

        const chunkSize = chunk instanceof Blob ? chunk.size : chunk.byteLength;
        const uploadStart = performance.now();

        const uploadResponse = await fetch(partUrl, {
            method: 'PUT',
            body: chunk,
            headers: {
                'Content-Type': file.type || 'application/octet-stream',
                'Content-Length': String(chunkSize),
            },
        });

        const uploadTime = performance.now() - uploadStart;

        // Calculate upload speed in MB/s
        const sizeMB = chunkSize / (1024 * 1024);
        const uploadSpeed = sizeMB / (uploadTime / 1000);

        metrics.uploadTime += uploadTime;
        metrics.chunkTimes.push({
            partNumber,
            encryptionMs: encryptionTime,
            uploadMs: uploadTime,
            size: chunkSize,
            uploadSpeed
        });

        if (!uploadResponse.ok) {
            throw new Error(
                `Failed to upload part ${partNumber}: ${uploadResponse.statusText}`,
            );
        }

        const etag = uploadResponse.headers.get('ETag');
        if (!etag) {
            throw new Error(`No ETag received for part ${partNumber}`);
        }

        uploadedChunks++;

        const currentProgress = Math.floor((uploadedChunks / totalChunks) * 100);
        if (
            progressCallback &&
            (currentProgress >= lastReportedProgress + 5 || currentProgress === 100)
        ) {
            lastReportedProgress = currentProgress;
            progressCallback(currentProgress);
        }

        console.log(
            `Uploaded part ${partNumber} (${uploadedChunks}/${totalChunks}) - ` +
            `Encrypt: ${encryptionTime.toFixed(2)}ms, Upload: ${uploadTime.toFixed(2)}ms, ` +
            `Speed: ${uploadSpeed.toFixed(2)} MB/s`
        );

        return {
            PartNumber: partNumber,
            ETag: etag.replace(/"/g, ''),
        };
    };

    let nextPartToProcess = 1;
    let nextPartToUpload = 1;

    for (let i = 0; i < Math.min(this.MAX_PREFETCH_CHUNKS, totalChunks); i++) {
        processingQueue.set(nextPartToProcess, processChunk(nextPartToProcess));
        nextPartToProcess++;
    }

    const uploadPromises: Promise<{ PartNumber: number; ETag: string }>[] = [];

    while (nextPartToUpload <= totalChunks) {
        if (processingQueue.has(nextPartToUpload)) {
            const processedResult = await processingQueue.get(nextPartToUpload)!;
            processingQueue.delete(nextPartToUpload);

            metrics.encryptionTime += processedResult.encryptionTime;

            const uploadPromise = uploadChunk(
                processedResult.partNumber,
                processedResult.chunk,
                processedResult.encryptionTime
            );
            uploadPromises.push(uploadPromise);

            // @ts-ignore
            processedResult.chunk = null;

            if (nextPartToProcess <= totalChunks) {
                processingQueue.set(nextPartToProcess, processChunk(nextPartToProcess));
                nextPartToProcess++;
            }

            nextPartToUpload++;

            if (uploadPromises.length >= this.MAX_CONCURRENT_UPLOADS) {
                const completedPart = await Promise.race(
                    uploadPromises.map((promise, idx) =>
                        promise.then((result) => ({ result, idx })),
                    ),
                );

                uploadPromises.splice(completedPart.idx, 1);
                uploadedParts.push(completedPart.result);
            }
        } else {
            await Promise.race(processingQueue.values());
        }
    }

    if (uploadPromises.length > 0) {
        const remainingResults = await Promise.all(
            uploadPromises.map(async (promise, idx) => {
                const result = await promise;
                return { result, idx };
            })
        );

        for (const item of remainingResults) {
            uploadedParts.push(item.result);
        }
    }

    const sortedParts = uploadedParts.sort((a, b) => a.PartNumber - b.PartNumber);

    console.log('All parts uploaded, completing multipart upload...');

    const completeStart = performance.now();
    const completeResponse = await window.cacheFetch.post(route("uploads.complete-multipart"), {
        uploadId,
        key,
        parts: sortedParts,
    });
    const data = await completeResponse.json();
    const result = {
        ...data,
        key: key // this is the s3 key, aka the path
    };

    metrics.completeTime = performance.now() - completeStart;

    if (progressCallback) {
        progressCallback(100);
    }

    // Calculate total time and print stats
    metrics.totalTime = performance.now() - totalStart;

    // Calculate average speeds
    let totalSize = 0;
    for (const chunk of metrics.chunkTimes) {
        totalSize += chunk.size;
    }
    const totalSizeMB = totalSize / (1024 * 1024);
    const effectiveSpeed = totalSizeMB / (metrics.totalTime / 1000);

    // Calculate min, max, avg upload speeds
    const speeds = metrics.chunkTimes.map(c => c.uploadSpeed);
    const minSpeed = Math.min(...speeds);
    const maxSpeed = Math.max(...speeds);
    const avgSpeed = speeds.reduce((sum, speed) => sum + speed, 0) / speeds.length;

    console.log(`
    === File Upload Performance Summary ===
    File: ${file.name}
    Size: ${totalSizeMB.toFixed(2)} MB
    Parts: ${totalChunks}
    Concurrency: ${this.MAX_CONCURRENT_UPLOADS}
    
    Time breakdown:
    - Encryption: ${metrics.encryptionTime.toFixed(2)}ms
    - Upload: ${metrics.uploadTime.toFixed(2)}ms
    - Init: ${metrics.initTime.toFixed(2)}ms
    - Complete: ${metrics.completeTime.toFixed(2)}ms
    - Total: ${metrics.totalTime.toFixed(2)}ms (${(metrics.totalTime / 1000).toFixed(2)}s)
    
    Upload Speed:
    - Min: ${minSpeed.toFixed(2)} MB/s
    - Max: ${maxSpeed.toFixed(2)} MB/s
    - Avg: ${avgSpeed.toFixed(2)} MB/s
    - Effective: ${effectiveSpeed.toFixed(2)} MB/s
    `);

    return result;
} catch (error) {
    const totalTime = performance.now() - totalStart;
    console.error(`Multipart upload failed after ${totalTime.toFixed(2)}ms:`, error);

    if (uploadId && key) {
        try {
            await window.cacheFetch.post(route('uploads.abort-multipart'), {
                uploadId,
                key,
            });
        } catch (abortError) {
            console.error('Failed to abort multipart upload:', abortError);
        }
    }

    processingQueue.clear();
    uploadQueue.length = 0;

    throw error;
} finally {
    // Clean up the crypto key after the upload is complete
    cryptoKey = null;
}
    }

    private async processFileWithWorkerPool(
        file: File,
        offset: number,
        chunkSize: number,
        cryptoKey: CryptoKey, // Receive the derived key
    ): Promise<{
        chunk: Blob | ArrayBuffer;
        error?: string;
    }> {
        try {
            // console.log(`Processing chunk at offset ${offset} (${chunkSize} bytes)`);
            const result = await this.workerPool.runTask({
                file: file,
                chunkSize: chunkSize,
                offset: offset,
                cryptoKey: cryptoKey, // Pass the derived key to the worker
                operation: 'encrypt'
            });
            // console.log(`Finished encrypting chunk at offset ${offset}`);

            if (result.error) {
                return { chunk: new Blob(), error: result.error };
            }

            return { chunk: result.chunk };
        } catch (error) {
            console.error('Error processing file chunk:', error);
            return {
                chunk: new Blob(),
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }

    public terminate(): void {
        this.workerPool.terminate();
    }
}
