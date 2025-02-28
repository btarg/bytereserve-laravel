<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class UserProvider extends Model
{
    protected $fillable = ['provider', 'provider_id'];

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}