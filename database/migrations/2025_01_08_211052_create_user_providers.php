<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up()
    {
        Schema::create('user_providers', function (Blueprint $table) {
            $table->id();
            $table->foreignUuid('user_id')->constrained()->onDelete('cascade');
            $table->string('provider');
            $table->string('provider_id');
            $table->timestamps();
            $table->unique(['provider', 'provider_id']);
        });
    }

    public function down()
    {
        Schema::dropIfExists('user_providers');
    }
};