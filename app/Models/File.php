<?php
namespace App\Models;

use App\Traits\S3Capable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\Cache;

class File extends Model
{
    use HasFactory, S3Capable;

    protected $fillable = [
        'user_id',
        'folder_id',
        'name',
        'path',
        'mime_type',
        'size',
        'hash'
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function folder(): BelongsTo
    {
        return $this->belongsTo(Folder::class);
    }

    /**
     * Get a short-lived presigned URL for the file
     */
    public function getPresignedUrl($expiresIn = 15): string
    {
        $cacheKey = "file_url_{$this->id}";

        return Cache::remember($cacheKey, $expiresIn * 60, function () use ($expiresIn) {
            $s3Client = $this->getS3Client();
            if (!$s3Client) {
                return '';
            }

            // Create a presigned URL that will expire
            $command = $s3Client->getCommand('GetObject', [
                'Bucket' => $this->getS3Bucket(),
                'Key' => $this->path, // Using path directly as the S3 key
                'ResponseContentDisposition' => 'attachment; filename="' . $this->name . '"',
            ]);

            $presignedRequest = $s3Client->createPresignedRequest($command, "+{$expiresIn} minutes");

            return (string) $presignedRequest->getUri();
        });
    }
}