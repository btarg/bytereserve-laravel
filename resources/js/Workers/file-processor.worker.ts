﻿// Use optimized buffer reading
const readBufferChunk = (
    file: File,
    start: number,
    length: number,
): Promise<ArrayBuffer> => {
    return new Promise((resolve, reject) => {
        const fileReader = new FileReader();
        fileReader.onload = () => resolve(fileReader.result as ArrayBuffer);
        fileReader.onerror = reject;
        fileReader.readAsArrayBuffer(file.slice(start, start + length));
    });
};

/**
 * Encrypts a chunk using AES-CTR
 * Format: [16-byte IV][encrypted data]
 */
async function encryptChunk(
    chunk: ArrayBuffer,
    key: CryptoKey,
): Promise<Uint8Array> {
    // Generate a random 16-byte IV for AES-CTR
    const iv = crypto.getRandomValues(new Uint8Array(16));

    // Encrypt the data using AES-CTR with the provided key and IV
    const encrypted = await crypto.subtle.encrypt(
        {
            name: 'AES-CTR',
            counter: iv,
            length: 128,
        },
        key,
        chunk,
    );

    // Combine IV and encrypted data into a single buffer
    const output = new Uint8Array(iv.byteLength + encrypted.byteLength);
    output.set(iv);
    output.set(new Uint8Array(encrypted), iv.byteLength);

    return output;
}

/**
 * Decrypts a chunk using AES-CTR
 * Expected format: [16-byte IV][encrypted data]
 */
async function decryptChunk(
    chunk: ArrayBuffer,
    key: CryptoKey,
): Promise<ArrayBuffer> {
    // Extract the IV (first 16 bytes)
    const data = new Uint8Array(chunk);
    const iv = data.slice(0, 16);
    const encrypted = data.slice(16);

    // Decrypt the data using AES-CTR with the provided key and extracted IV
    return await crypto.subtle.decrypt(
        {
            name: 'AES-CTR',
            counter: iv,
            length: 128,
        },
        key,
        encrypted,
    );
}

/**
 * Process a file chunk: either encrypt or decrypt based on the operation flag
 */
async function processChunk(
    chunk: ArrayBuffer, 
    key: CryptoKey, 
    operation: 'encrypt' | 'decrypt'
): Promise<Uint8Array | ArrayBuffer> {
    if (operation === 'encrypt') {
        return encryptChunk(chunk, key);
    } else {
        return decryptChunk(chunk, key);
    }
}

self.onmessage = async (e: MessageEvent) => {
    const { file, chunkSize, offset, cryptoKey, operation = 'encrypt' } = e.data;

    try {
        // Read the chunk from the file
        const arrayBuffer = await readBufferChunk(file, offset, chunkSize);
        
        // Process the chunk (encrypt or decrypt)
        const processedChunk = await processChunk(
            arrayBuffer, 
            cryptoKey,
            operation as 'encrypt' | 'decrypt'
        );
        
        // Calculate whether this is the last chunk
        const isDone = offset + chunkSize >= file.size;
        
        // Create a Uint8Array if result is ArrayBuffer (for consistent transfer)
        const transferableChunk = processedChunk instanceof ArrayBuffer 
            ? new Uint8Array(processedChunk) 
            : processedChunk;
            
        // Send the processed chunk back to the main thread
        self.postMessage(
            {
                fileName: file.name,
                chunk: transferableChunk,
                offset,
                done: isDone,
                operation, // Include the operation that was performed
            },
            {
                // Use transferable objects to avoid copying large buffers
                transfer: [transferableChunk.buffer],
            },
        );
    } catch (error) {
        console.error(`${operation.toUpperCase()} error:`, error);
        self.postMessage({
            error: error instanceof Error ? error.message : 'Unknown error',
            fileName: file.name,
            operation,
        });
    }
};

export { };