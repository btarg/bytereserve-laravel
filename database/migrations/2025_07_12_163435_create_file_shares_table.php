<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('file_shares', function (Blueprint $table) {
            $table->id();
            $table->foreignId('file_id')->constrained()->onDelete('cascade');
            $table->foreignId('user_id')->constrained()->onDelete('cascade'); // User who shared the file
            $table->string('token', 64)->unique(); // Unique share token
            $table->timestamp('expires_at')->nullable(); // Optional expiration date
            $table->boolean('is_active')->default(true); // Allow deactivating shares
            $table->integer('download_count')->default(0); // Track download count
            $table->integer('max_downloads')->nullable(); // Optional download limit
            $table->timestamps();
            
            $table->index(['token', 'is_active']);
            $table->index('expires_at');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('file_shares');
    }
};
