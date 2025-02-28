<?php
namespace App\Traits;

use Aws\S3\S3Client;
use Illuminate\Support\Facades\Log;
use Throwable;

trait S3Capable
{
    protected function getS3Client(): ?S3Client
    {
        try {
            // Ensure endpoint has proper protocol prefix
            $endpoint = env('AWS_ENDPOINT');
            if ($endpoint && !preg_match('/^https?:\/\//', $endpoint)) {
                $endpoint = 'https://' . $endpoint;
            }

            // Initialize S3 client with correct configuration
            $client = new S3Client([
                'endpoint' => $endpoint,
                'version' => 'latest',
                'region'  => env('AWS_REGION'),
                'credentials' => [
                    'key'    => env('AWS_ACCESS_KEY_ID'),
                    'secret' => env('AWS_SECRET_ACCESS_KEY'),
                ],
                'use_path_style_endpoint' => true,
                'signature_version' => 'v4',
            ]);

            return $client;
        } catch (Throwable $e) {
            Log::error('S3 Client initialization failed', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);
            return null;
        }
    }

    protected function getS3Bucket(): string
    {
        return env('AWS_BUCKET');
    }
}