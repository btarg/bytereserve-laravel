<?php

namespace App\Http\Controllers;

use App\Traits\S3Capable;
use Illuminate\Http\Request;
use Throwable;
use Illuminate\Support\Facades\Log;

class S3UploadController extends Controller
{
    use S3Capable;

    protected $client;
    protected $bucket;

    public function __construct() {
        $this->client = $this->getS3Client();
        $this->bucket = $this->getS3Bucket();
    }

    /**
     * Get a presigned URL for direct upload of a small file
     */
    public function getDirectUploadUrl(Request $request)
    {
        try {
            $request->validate([
                'file_name' => 'required|string',
                'content_type' => 'required|string',
                'folder_id' => 'nullable|numeric', // Accept folder_id parameter
            ]);

            // Determine the S3 key based on folder structure
            $key = 'uploads/' . $request->file_name;

            // If folder_id is provided, get the folder path
            if ($request->has('folder_id') && $request->folder_id) {
                try {
                    $folder = \App\Models\Folder::find($request->folder_id);
                    if ($folder) {
                        // Build folder path by traversing parent folders
                        $folderPath = $this->buildFolderPath($folder);
                        $key = 'uploads/' . trim($folderPath, '/') . '/' . $request->file_name;
                    }
                } catch (\Exception $e) {
                    Log::warning('Error determining folder path for upload', [
                        'folder_id' => $request->folder_id,
                        'error' => $e->getMessage()
                    ]);
                    // Fallback to default path if folder lookup fails
                }
            }

            $command = $this->client->getCommand('PutObject', [
                'Bucket' => $this->bucket,
                'Key' => $key,
                'ContentType' => $request->content_type,
            ]);

            $presignedRequest = $this->client->createPresignedRequest($command, '+15 minutes');
            $url = (string) $presignedRequest->getUri();

            return response()->json([
                'url' => $url,
                'key' => $key
            ]);
        } catch (Throwable $exception) {
            Log::error('Direct upload URL generation failed', [
                'exception' => $exception->getMessage(),
                'trace' => $exception->getTraceAsString()
            ]);

            return response()->json(['message' => $exception->getMessage()], 500);
        }
    }

    /**
     * Helper method to build the folder path by traversing parents
     */
    protected function buildFolderPath($folder)
    {
        if (!$folder) {
            return '';
        }

        $path = $folder->name;
        $current = $folder;

        // Traverse up the folder hierarchy to build the path
        while ($current->parent_id) {
            $current = $current->parent;
            if ($current) {
                $path = $current->name . '/' . $path;
            } else {
                break;
            }
        }

        return $path;
    }

    /**
     * Initiate a multipart upload
     */
    public function initiateMultipartUpload(Request $request)
    {
        try {
            $request->validate([
                'file_name' => 'required|string',
                'content_type' => 'required|string',
                'folder_id' => 'nullable|numeric', // Accept folder_id parameter
            ]);

            // Determine the S3 key based on folder structure
            $key = 'uploads/' . $request->file_name;

            // If folder_id is provided, get the folder path
            if ($request->has('folder_id') && $request->folder_id) {
                try {
                    $folder = \App\Models\Folder::find($request->folder_id);
                    if ($folder) {
                        // Build folder path by traversing parent folders
                        $folderPath = $this->buildFolderPath($folder);
                        $key = 'uploads/' . trim($folderPath, '/') . '/' . $request->file_name;
                    }
                } catch (\Exception $e) {
                    Log::warning('Error determining folder path for upload', [
                        'folder_id' => $request->folder_id,
                        'error' => $e->getMessage()
                    ]);
                    // Fallback to default path if folder lookup fails
                }
            }

            // For debugging purposes
            Log::info('Initiating multipart upload', [
                'bucket' => $this->bucket,
                'key' => $key,
                'content_type' => $request->content_type
            ]);

            $result = $this->client->createMultipartUpload([
                'Bucket' => $this->bucket,
                'Key' => $key,
                'ContentType' => $request->content_type,
            ]);

            return response()->json([
                'uploadId' => $result['UploadId'],
                'key' => $key
            ]);
        } catch (Throwable $exception) {
            Log::error('Multipart upload initiation failed', [
                'exception' => $exception->getMessage(),
                'trace' => $exception->getTraceAsString()
            ]);

            return response()->json(['message' => $exception->getMessage()], 500);
        }
    }

    /**
     * Get a presigned URL for uploading a part
     */
    public function getPartUploadUrl(Request $request)
    {
        try {
            $request->validate([
                'uploadId' => 'required|string',
                'key' => 'required|string',
                'partNumber' => 'required|integer|min:1|max:10000',
            ]);

            $command = $this->client->getCommand('UploadPart', [
                'Bucket' => $this->bucket,
                'Key' => $request->key,
                'UploadId' => $request->uploadId,
                'PartNumber' => $request->partNumber,
            ]);

            $presignedRequest = $this->client->createPresignedRequest($command, '+15 minutes');

            return response()->json([
                'url' => (string) $presignedRequest->getUri()
            ]);
        } catch (Throwable $exception) {
            Log::error('Part upload URL generation failed', [
                'exception' => $exception->getMessage(),
                'trace' => $exception->getTraceAsString()
            ]);

            return response()->json(['message' => $exception->getMessage()], 500);
        }
    }

    /**
     * Get multiple presigned URLs for uploading parts
     */
    public function getBulkPartUploadUrls(Request $request)
    {
        try {
            $request->validate([
                'uploadId' => 'required|string',
                'key' => 'required|string',
                'partNumbers' => 'required|array',
                'partNumbers.*' => 'integer|min:1|max:10000',
            ]);

            $urls = [];

            foreach ($request->partNumbers as $partNumber) {
                $command = $this->client->getCommand('UploadPart', [
                    'Bucket' => $this->bucket,
                    'Key' => $request->key,
                    'UploadId' => $request->uploadId,
                    'PartNumber' => $partNumber,
                ]);

                $presignedRequest = $this->client->createPresignedRequest($command, '+15 minutes');
                $urls[$partNumber] = (string) $presignedRequest->getUri();
            }

            return response()->json([
                'urls' => $urls
            ]);
        } catch (Throwable $exception) {
            Log::error('Bulk part upload URL generation failed', [
                'exception' => $exception->getMessage(),
                'trace' => $exception->getTraceAsString()
            ]);

            return response()->json(['message' => $exception->getMessage()], 500);
        }
    }

    /**
     * Complete a multipart upload
     */
    public function completeMultipartUpload(Request $request)
    {
        try {
            $result = $this->client->completeMultipartUpload([
                'Bucket' => $this->bucket,
                'Key' => $request->key,
                'UploadId' => $request->uploadId,
                'MultipartUpload' => [
                    'Parts' => $request->parts
                ]
            ]);

            // Ensure we have a location/URL for the completed object
            $fileUrl = $result['Location'] ?? $this->client->getObjectUrl($this->bucket, $request->key);

            return response()->json([
                'location' => $fileUrl
            ]);
        } catch (Throwable $e) {
            Log::error('Failed to complete multipart upload', [
                'error' => $e->getMessage(),
                'key' => $request->key,
                'uploadId' => $request->uploadId
            ]);
            return response()->json(['error' => 'Failed to complete multipart upload'], 500);
        }
    }

    /**
     * Abort a multipart upload
     */
    public function abortMultipartUpload(Request $request)
    {
        try {
            $request->validate([
                'uploadId' => 'required|string',
                'key' => 'required|string',
            ]);

            $this->client->abortMultipartUpload([
                'Bucket' => $this->bucket,
                'Key' => $request->key,
                'UploadId' => $request->uploadId,
            ]);

            return response()->json(['message' => 'Upload aborted']);
        } catch (Throwable $exception) {
            Log::error('Multipart upload abort failed', [
                'exception' => $exception->getMessage(),
                'trace' => $exception->getTraceAsString()
            ]);

            return response()->json(['message' => $exception->getMessage()], 500);
        }
    }

}
